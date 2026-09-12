import os

# Set before any application imports; test traffic never reaches a real LLM.
os.environ["ENVIRONMENT"] = "test"
os.environ["AGENT_MODE"] = "mock"
os.environ["DATABASE_URL"] = "postgresql+asyncpg://btl:btl@localhost:54329/btl_test"
os.environ["CHECKPOINT_URL"] = "postgresql://btl:btl@localhost:54329/btl_test"
