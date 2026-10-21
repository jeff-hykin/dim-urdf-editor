# dim-urdf-editor

A URDF frame-tree viewer/editor, as a dimOS Desktop app: open a URDF, click/drag frames, edit joint origins, axes,
limits and names, pose joints, add/remove frames, and save or download the edited URDF.

```sh
dimos-desktop install https://github.com/jeff-hykin/dim-urdf-editor
```

Every action is an HTTP endpoint (`backend/routes.ts`, served as `openapi.json` and listed in `dimos.yaml`), so
Desktop's agent can drive the editor the same way the page does.

Develop: `deno task dev` (backend on :8787) and `cd frontend && deno task dev`. Check: `deno task test`,
`deno task check`, `cd frontend && deno task typecheck`, `nix build .#dimosApp` (`deno task update-hashes` after
changing frontend/deno.json or deno.lock).

Licensed under the Apache License, Version 2.0.

<img width="1396" height="799" alt="Screenshot 2026-06-22 at 10 51 15 PM" src="https://github.com/user-attachments/assets/02731ea0-32c4-4a73-9932-ae89336ff0ae" />
