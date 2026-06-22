from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class FamilyTreeBaseModel(BaseModel):
    """Base for request/input schemas — accepts and emits camelCase JSON."""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


class FamilyTreeOrmBaseModel(BaseModel):
    """Base for response schemas populated from ORM objects."""
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )
