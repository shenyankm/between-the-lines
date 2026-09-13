"""ASGI entry point; tests and tools can import the factory directly."""

from .config import get_settings
from .factory import create_app

app = create_app(get_settings())
