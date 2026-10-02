import pytest

from tests.conftest import ADMIN, make_client, login


async def test_requires_login(app):
    async with make_client(app) as c:
        assert (await c.get("/api/connections")).status_code == 401
        assert (await c.get("/api/auth/me")).status_code == 401
        assert (await c.get("/api/transactions")).status_code == 401


async def test_state_changing_requests_need_ajax_header(app):
    async with make_client(app) as c:
        c.headers.pop("X-Requested-With")
        r = await c.post("/api/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]})
        assert r.status_code == 403


async def test_login_logout_and_cookie_flags(app):
    async with make_client(app) as c:
        r = await c.post("/api/auth/login", json={"email": "ADMIN@example.com ", "password": ADMIN[1]})
        assert r.status_code == 200 and r.json()["role"] == "admin"
        cookie = r.headers["set-cookie"].lower()
        assert "httponly" in cookie and "samesite=strict" in cookie
        assert "password" not in r.text
        assert (await c.get("/api/auth/me")).status_code == 200
        raw = c.cookies.get("pgweb_session")
        assert (await c.post("/api/auth/logout")).status_code == 204
        c.cookies.set("pgweb_session", raw)  # replaying the old cookie must fail: the session is gone server-side
        assert (await c.get("/api/auth/me")).status_code == 401


async def test_bad_credentials_are_uniform(app):
    async with make_client(app) as c:
        a = await c.post("/api/auth/login", json={"email": "nobody@example.com", "password": "whatever-long"})
        b = await c.post("/api/auth/login", json={"email": ADMIN[0], "password": "wrong-password-x"})
        assert a.status_code == b.status_code == 401
        assert a.json() == b.json()  # can't tell which emails exist


async def test_lockout_after_repeated_failures(app, new_user):
    victim = await new_user()
    async with make_client(app) as c:
        for _ in range(3):
            assert (await c.post("/api/auth/login", json={"email": victim.email, "password": "nope-nope-nope"})).status_code == 401
        r = await c.post("/api/auth/login", json={"email": victim.email, "password": "a-long-password"})
        assert r.status_code == 429  # even the right password is refused while locked


async def test_user_admin_is_admin_only(app, admin, new_user):
    member = await new_user()
    assert (await member.get("/api/users")).status_code == 403
    assert (await member.post("/api/users", json={"email": "x@example.com", "password": "a-long-password"})).status_code == 403
    assert (await member.get("/api/audit")).status_code == 403
    assert (await admin.get("/api/users")).status_code == 200


async def test_password_policy_and_duplicates(admin):
    r = await admin.post("/api/users", json={"email": "weak@example.com", "password": "short"})
    assert r.status_code == 422
    r = await admin.post("/api/users", json={"email": "not-an-email", "password": "a-long-password"})
    assert r.status_code == 422
    r = await admin.post("/api/users", json={"email": ADMIN[0], "password": "a-long-password"})
    assert r.status_code == 409


async def test_deactivation_kills_sessions_immediately(admin, new_user):
    member = await new_user()
    assert (await member.get("/api/auth/me")).status_code == 200
    assert (await admin.patch(f"/api/users/{member.user_id}", json={"is_active": False})).status_code == 200
    assert (await member.get("/api/auth/me")).status_code == 401


async def test_cannot_lock_out_the_last_admin(admin):
    me = (await admin.get("/api/auth/me")).json()
    r = await admin.patch(f"/api/users/{me['id']}", json={"role": "member"})
    assert r.status_code == 400
    r = await admin.patch(f"/api/users/{me['id']}", json={"is_active": False})
    assert r.status_code == 400


async def test_change_password_signs_out_other_devices(app, new_user):
    a = await new_user()
    b = make_client(app)
    await login(b, a.email, "a-long-password")
    r = await a.post("/api/auth/password", json={"current_password": "a-long-password", "new_password": "another-long-password"})
    assert r.status_code == 204
    assert (await a.get("/api/auth/me")).status_code == 200  # this device stays signed in
    assert (await b.get("/api/auth/me")).status_code == 401  # others are signed out
    bad = await a.post("/api/auth/password", json={"current_password": "wrong-password-x", "new_password": "yet-another-long-one"})
    assert bad.status_code == 400
    await b.aclose()
