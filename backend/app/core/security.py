import hashlib
import secrets
from functools import lru_cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet

from app.core.config import get_settings


@lru_cache
def _master_key() -> bytes:
    s = get_settings()
    if s.secret_key:
        return s.secret_key.encode()
    key_file = s.data_dir / "secret.key"
    if not key_file.exists():
        key_file.write_bytes(Fernet.generate_key())
        key_file.chmod(0o600)
    return key_file.read_bytes().strip()


def encrypt(plain: str) -> str:
    return Fernet(_master_key()).encrypt(plain.encode()).decode()


def decrypt(token: str) -> str:
    return Fernet(_master_key()).decrypt(token.encode()).decode()


# --- user passwords (one-way) ---
_hasher = PasswordHasher()
# Verified against when the email is unknown, so response time doesn't reveal which emails exist.
_DUMMY_HASH = _hasher.hash("pgweb2-dummy-password")

MIN_PASSWORD_LENGTH = 10


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


# --- session tokens ---
def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
