from pydantic import BaseModel


class JobStarted(BaseModel):
    job_id: str


class JobOut(BaseModel):
    id: str
    type: str
    status: str
    progress_pct: int
    result_workspace_id: str | None = None
    error: str | None = None
    created_at: str

    model_config = {"from_attributes": True}
