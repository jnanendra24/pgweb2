import json
import uuid


async def _setup(new_user, conn_body):
    user = await new_user()
    created = await user.post('/api/connections', json=conn_body)
    assert created.status_code == 201, created.text
    conn_id = created.json()['id']
    table = 'edit_' + uuid.uuid4().hex[:12]
    sql = f'CREATE TABLE {table} (id serial PRIMARY KEY, name text NOT NULL, note text, data jsonb, active boolean)'
    assert (await user.post(f'/api/connections/{conn_id}/query', json={'sql': sql})).status_code == 200
    root = f'/api/connections/{conn_id}/tables/public/{table}'
    return user, conn_id, table, root


async def _rows(user, root):
    response = await user.get(f'{root}/rows', params={'order_by': 'id'})
    assert response.status_code == 200, response.text
    return response.json()


async def test_stage_batch_updates_inserts_deletes_and_null(new_user, conn_body, admin):
    user, conn_id, table, root = await _setup(new_user, conn_body)
    q = f'/api/connections/{conn_id}/query'
    assert (await user.post(q, json={'sql': f"INSERT INTO {table} (name, note) VALUES ('first', 'old'), ('second', 'old')"})).status_code == 200
    before = await _rows(user, root)
    assert len(before['row_versions']) == 2 and all(before['row_versions'])
    first, second = before['rows']
    changes = {
        'updates': [{'primary_key': {'id': first[0]}, 'version': before['row_versions'][0], 'values': {'note': None, 'data': {'ok': True}, 'active': True}}],
        'deletes': [{'primary_key': {'id': second[0]}, 'version': before['row_versions'][1]}],
        'inserts': [{'values': {'name': 'third'}}, {'values': {'name': 'fourth', 'note': None}}],
    }
    response = await user.post(f'{root}/changes', json=changes)
    assert response.status_code == 200, response.text
    assert response.json() == {'updated': 1, 'inserted': 2, 'deleted': 1}
    after = (await _rows(user, root))['rows']
    assert [row[1] for row in after] == ['first', 'third', 'fourth']
    assert after[0][2] is None and json.loads(after[0][3]) == {'ok': True} and after[0][4] is True
    log = (await admin.get('/api/audit', params={'user_email': user.email, 'action': 'table_changes'})).json()
    assert log[0]['row_count'] == 4 and log[0]['error'] is None


async def test_stale_row_and_constraint_error_rollback_whole_batch(new_user, conn_body):
    user, conn_id, table, root = await _setup(new_user, conn_body)
    q = f'/api/connections/{conn_id}/query'
    await user.post(q, json={'sql': f"INSERT INTO {table} (name) VALUES ('one'), ('two')"})
    before = await _rows(user, root)
    a, b = before['rows']
    await user.post(q, json={'sql': f"UPDATE {table} SET name = 'newer' WHERE id = {b[0]}"})
    changes = {'updates': [
        {'primary_key': {'id': a[0]}, 'version': before['row_versions'][0], 'values': {'name': 'should rollback'}},
        {'primary_key': {'id': b[0]}, 'version': before['row_versions'][1], 'values': {'name': 'stale'}},
    ]}
    stale = await user.post(f'{root}/changes', json=changes)
    assert stale.status_code == 409, stale.text
    assert [row[1] for row in (await _rows(user, root))['rows']] == ['one', 'newer']

    fresh = await _rows(user, root)
    bad = await user.post(f'{root}/changes', json={
        'updates': [{'primary_key': {'id': a[0]}, 'version': fresh['row_versions'][0], 'values': {'name': 'should rollback'}}],
        'inserts': [{'values': {'name': None}}],
    })
    assert bad.status_code == 400, bad.text
    assert [row[1] for row in (await _rows(user, root))['rows']] == ['one', 'newer']
    invalid_type = await user.post(f'{root}/changes', json={
        'updates': [{'primary_key': {'id': a[0]}, 'version': fresh['row_versions'][0], 'values': {'active': 'maybe'}}],
    })
    assert invalid_type.status_code == 400
    assert [row[1] for row in (await _rows(user, root))['rows']] == ['one', 'newer']


async def test_edit_guards_for_read_only_no_key_and_views(new_user, conn_body):
    user, conn_id, table, root = await _setup(new_user, conn_body)
    ro = await user.post('/api/connections', json={**conn_body, 'name': 'read only', 'read_only': True})
    assert ro.status_code == 201
    ro_root = f"/api/connections/{ro.json()['id']}/tables/public/{table}"
    assert (await user.post(f'{ro_root}/changes', json={'inserts': [{'values': {'name': 'no'}}]})).status_code == 403

    q = f'/api/connections/{conn_id}/query'
    no_key = 'nokey_' + uuid.uuid4().hex[:12]
    view = 'view_' + uuid.uuid4().hex[:12]
    await user.post(q, json={'sql': f'CREATE TABLE {no_key} (name text)'})
    await user.post(q, json={'sql': f'CREATE VIEW {view} AS SELECT * FROM {table}'})
    for relation in (no_key, view):
        path = f'/api/connections/{conn_id}/tables/public/{relation}'
        assert (await user.get(f'{path}/rows')).status_code == 200
        response = await user.post(f'{path}/changes', json={'inserts': [{'values': {'name': 'no'}}]})
        assert response.status_code == 400, response.text


async def test_table_changes_require_connection_access(new_user, conn_body):
    owner, _, _, root = await _setup(new_user, conn_body)
    other = await new_user()
    assert (await other.post(f'{root}/changes', json={'inserts': [{'values': {'name': 'no'}}]})).status_code == 404


async def test_partitioned_table_can_be_browsed_and_edited(new_user, conn_body):
    user = await new_user()
    created = await user.post('/api/connections', json=conn_body)
    conn_id = created.json()['id']
    table = 'part_' + uuid.uuid4().hex[:12]
    q = f'/api/connections/{conn_id}/query'
    assert (await user.post(q, json={'sql': f'CREATE TABLE {table} (id integer, name text, PRIMARY KEY (id)) PARTITION BY RANGE (id)'})).status_code == 200
    assert (await user.post(q, json={'sql': f'CREATE TABLE {table}_one PARTITION OF {table} FOR VALUES FROM (0) TO (100)'})).status_code == 200
    root = f'/api/connections/{conn_id}/tables/public/{table}'
    added = await user.post(f'{root}/changes', json={'inserts': [{'values': {'id': 1, 'name': 'before'}}]})
    assert added.status_code == 200, added.text
    browsed = await _rows(user, root)
    changed = await user.post(f'{root}/changes', json={'updates': [{
        'primary_key': {'id': 1}, 'version': browsed['row_versions'][0], 'values': {'name': 'after'},
    }]})
    assert changed.status_code == 200, changed.text
    assert (await _rows(user, root))['rows'][0][1] == 'after'


async def test_structured_table_filters_bind_values_and_support_in_and_null(new_user, conn_body):
    user, conn_id, table, root = await _setup(new_user, conn_body)
    q = f'/api/connections/{conn_id}/query'
    await user.post(q, json={'sql': f"INSERT INTO {table} (name, note) VALUES ('O''Reilly %_ value', NULL), ('second', 'present'), ('third', NULL)"})
    endpoint = f'{root}/rows/search'

    exact = await user.post(endpoint, json={'conditions': [{'column': 'name', 'operator': 'eq', 'value': "O'Reilly %_ value"}]})
    assert exact.status_code == 200, exact.text
    assert [row[1] for row in exact.json()['rows']] == ["O'Reilly %_ value"]

    in_null = await user.post(endpoint, json={'conditions': [
        {'column': 'name', 'operator': 'in', 'value': ['second', 'third']},
        {'column': 'note', 'operator': 'is_null'},
    ], 'combine': 'and'})
    assert in_null.status_code == 200, in_null.text
    assert [row[1] for row in in_null.json()['rows']] == ['third']

    any_match = await user.post(endpoint, json={'conditions': [
        {'column': 'name', 'operator': 'eq', 'value': 'second'},
        {'column': 'note', 'operator': 'is_not_null'},
    ], 'combine': 'or'})
    assert any_match.status_code == 200, any_match.text
    assert {row[1] for row in any_match.json()['rows']} == {'second'}

    invalid = await user.post(endpoint, json={'conditions': [{'column': 'name) OR true --', 'operator': 'eq', 'value': 'x'}]})
    assert invalid.status_code == 400

    raw = await user.get(f'{root}/rows', params={'filter': "name = 'second'"})
    assert raw.status_code == 200, raw.text
    assert [row[1] for row in raw.json()['rows']] == ['second']
