# Unraid Templates

The Unraid XML templates for this application are automatically published to the `unraid-templates` branch by a GitHub Actions workflow.
You can add `https://github.com/maxi-smidt/family-tree/tree/unraid-templates` to your Unraid Docker Template Repositories, or submit this repository branch to Unraid Community Applications.

**Note on Networking:**
The `frontend` proxy currently hardcodes the backend address as `http://backend:8000`. Therefore, you must run both the `FamilyTree-Frontend` and `FamilyTree-Backend` containers on a custom docker network in Unraid, and name the backend container `backend`, so the DNS resolution works.
