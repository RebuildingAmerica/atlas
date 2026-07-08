"""Compatibility barrel for resource ownership and annotation models."""

from __future__ import annotations

from typing import Any

from atlas.platform.database import db  # noqa: F401

from .ownership_annotations import (
    create_annotation as _create_annotation,
)
from .ownership_annotations import (
    delete_annotation as _delete_annotation,
)
from .ownership_annotations import (
    get_annotation as _get_annotation,
)
from .ownership_annotations import (
    list_annotations as _list_annotations,
)
from .ownership_annotations import (
    update_annotation as _update_annotation,
)
from .ownership_directory import (
    create_ownership as _create_ownership,
)
from .ownership_directory import (
    delete_ownership as _delete_ownership,
)
from .ownership_directory import (
    get_directory_domain as _get_directory_domain,
)
from .ownership_directory import (
    get_directory_domain_by_domain as _get_directory_domain_by_domain,
)
from .ownership_directory import (
    get_ownership as _get_ownership,
)
from .ownership_directory import (
    get_verified_directory_domain as _get_verified_directory_domain,
)
from .ownership_directory import (
    list_by_org as _list_by_org,
)
from .ownership_directory import (
    update_visibility as _update_visibility,
)
from .ownership_directory import (
    upsert_directory_domain as _upsert_directory_domain,
)
from .ownership_directory import (
    verify_directory_domain as _verify_directory_domain,
)
from .ownership_directory_public import (
    get_directory_config as _get_directory_config,
)
from .ownership_directory_public import (
    list_public_directory_index as _list_public_directory_index,
)
from .ownership_directory_public import (
    upsert_directory_config as _upsert_directory_config,
)
from .ownership_models import (
    AnnotationModel,
    AnnotationTargetError,
    DirectoryConfigModel,
    DirectoryDomainAlreadyClaimedError,
    DirectoryDomainModel,
    OwnershipModel,
    PublicDirectoryIndexModel,
    _decode_string_list,
)

__all__ = [
    "AnnotationModel",
    "AnnotationTargetError",
    "DirectoryConfigModel",
    "DirectoryDomainAlreadyClaimedError",
    "DirectoryDomainModel",
    "OwnershipCRUD",
    "OwnershipModel",
    "PublicDirectoryIndexModel",
    "_decode_string_list",
]


class OwnershipCRUD:
    """CRUD operations for resource ownership and annotations."""

    @staticmethod
    async def create_ownership(*args: Any, **kwargs: Any) -> Any:
        return await _create_ownership(*args, **kwargs)

    @staticmethod
    async def get_ownership(*args: Any, **kwargs: Any) -> Any:
        return await _get_ownership(*args, **kwargs)

    @staticmethod
    async def list_by_org(*args: Any, **kwargs: Any) -> Any:
        return await _list_by_org(*args, **kwargs)

    @staticmethod
    async def delete_ownership(*args: Any, **kwargs: Any) -> Any:
        return await _delete_ownership(*args, **kwargs)

    @staticmethod
    async def update_visibility(*args: Any, **kwargs: Any) -> Any:
        return await _update_visibility(*args, **kwargs)

    @staticmethod
    async def upsert_directory_domain(*args: Any, **kwargs: Any) -> Any:
        return await _upsert_directory_domain(*args, **kwargs)

    @staticmethod
    async def verify_directory_domain(*args: Any, **kwargs: Any) -> Any:
        return await _verify_directory_domain(*args, **kwargs)

    @staticmethod
    async def get_directory_domain(*args: Any, **kwargs: Any) -> Any:
        return await _get_directory_domain(*args, **kwargs)

    @staticmethod
    async def get_directory_domain_by_domain(*args: Any, **kwargs: Any) -> Any:
        return await _get_directory_domain_by_domain(*args, **kwargs)

    @staticmethod
    async def get_verified_directory_domain(*args: Any, **kwargs: Any) -> Any:
        return await _get_verified_directory_domain(*args, **kwargs)

    @staticmethod
    async def upsert_directory_config(*args: Any, **kwargs: Any) -> Any:
        return await _upsert_directory_config(*args, **kwargs)

    @staticmethod
    async def get_directory_config(*args: Any, **kwargs: Any) -> Any:
        return await _get_directory_config(*args, **kwargs)

    @staticmethod
    async def list_public_directory_index(*args: Any, **kwargs: Any) -> Any:
        return await _list_public_directory_index(*args, **kwargs)

    @staticmethod
    async def create_annotation(*args: Any, **kwargs: Any) -> Any:
        return await _create_annotation(*args, **kwargs)

    @staticmethod
    async def list_annotations(*args: Any, **kwargs: Any) -> Any:
        return await _list_annotations(*args, **kwargs)

    @staticmethod
    async def get_annotation(*args: Any, **kwargs: Any) -> Any:
        return await _get_annotation(*args, **kwargs)

    @staticmethod
    async def update_annotation(*args: Any, **kwargs: Any) -> Any:
        return await _update_annotation(*args, **kwargs)

    @staticmethod
    async def delete_annotation(*args: Any, **kwargs: Any) -> Any:
        return await _delete_annotation(*args, **kwargs)
