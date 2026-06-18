# Hardcoded Value Inventory

This inventory tracks the triage for issue #319. Values fall into three
categories:

- **Runtime setting**: an administrator can change it without restarting the
  application. The value lives in `app_settings`.
- **Deploy-time setting**: an operator configures it through the environment
  before starting the backend.
- **Code invariant**: changing it alters an internal contract, safety boundary,
  or UI implementation detail and therefore requires a tested code change.

The audit is intentionally incremental. Each runtime cluster should be moved in
a focused pull request rather than changing unrelated behavior at once.

## Current inventory

| Value                           | Location                                                  | Category              | Status and rationale                                                                                                             |
| ------------------------------- | --------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Image upload size               | `backend/app/services/storage.py`                         | Runtime setting       | Implemented as `max_image_upload_mb`; backend enforcement and admin UI use the typed `AppSetting` value.                         |
| Image input dimension           | `backend/app/services/storage.py`                         | Runtime setting       | Implemented as `max_image_dimension`; useful for tuning memory and decompression risk per instance.                              |
| Document/attachment upload size | Backend storage and frontend attachment validation        | Runtime setting       | Implemented as `max_document_upload_mb`; `/auth/config` is the frontend source of truth, removing the duplicated 25 MB constant. |
| Stored image width/height       | Backend normalization and frontend pre-resize             | Code invariant        | Backend-owned 1920 by 1080 normalization target. Published through `/auth/config` so the frontend does not duplicate it.         |
| Login attempt count/window      | `backend/app/core/config.py`                              | Deploy-time setting   | Security and capacity policy that should be reviewed with the deployment. Already environment-backed; keep outside the admin UI. |
| API maximum page limit          | `backend/app/api/pagination.py`                           | Code invariant        | Request-cost safety boundary shared by all list endpoints. Keep centrally enforced in code.                                      |
| Geocoding request delay         | `backend/app/services/geocoding.py`                       | Code invariant        | Enforces the public Nominatim usage policy and must not be weakened from the admin UI.                                           |
| Geocoding batch cap             | `backend/app/services/geocoding.py`                       | Deploy-time candidate | Operational throughput control. Move only alongside configurable geocoding providers and provider-specific validation.           |
| Parent age quality thresholds   | `backend/app/services/quality_checks.py`                  | Runtime candidate     | Instance-specific false-positive policy. A later quality-settings PR should expose both minimum and maximum together.            |
| List page size                  | `frontend/src/components/view/list-view/ListView.tsx`     | Code invariant        | Local presentation default with no backend contract. Keep in the component or a frontend constants module.                       |
| Canvas search result count      | `frontend/src/components/view/tree-view/CanvasSearch.tsx` | Code invariant        | Small interaction-design choice, not an operator concern.                                                                        |
| Tree layout spacing/grid        | `frontend/src/utils/layoutUtils.ts`                       | Code invariant        | Part of the layout algorithm. Changes require visual and algorithm tests, not an instance setting.                               |
| Undo history length             | `frontend/src/hooks/useMemberStore.ts`                    | Code invariant        | Client memory/UX tradeoff local to a browser session.                                                                            |
| Tree export pixel cap           | `frontend/src/hooks/useTreeExport.ts`                     | Code invariant        | Browser rendering safety boundary.                                                                                               |
| Backup interval/retention       | `backend/app/services/settings_service.py`                | Runtime setting       | Already implemented in `app_settings` and the admin UI.                                                                          |
| Account deletion grace period   | `backend/app/services/settings_service.py`                | Runtime setting       | Already implemented in `app_settings` and the admin UI.                                                                          |
| Self-registration               | Environment seed plus `app_settings`                      | Runtime setting       | Environment value seeds the first boot; the database is authoritative afterwards.                                                |

## Runtime media keys

The backend seeds these keys on startup when they are missing:

| Key                      | Default |  Valid range |
| ------------------------ | ------: | -----------: |
| `max_image_upload_mb`    |   10 MB |     1-100 MB |
| `max_image_dimension`    | 4096 px | 256-16384 px |
| `max_document_upload_mb` |   25 MB |     1-500 MB |

Stored values are range-checked when read as well as when updated. Invalid
database values fall back to the documented defaults.
