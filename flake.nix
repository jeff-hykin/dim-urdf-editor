{
    description = "dim-urdf-editor: a URDF frame-tree viewer/editor as a dimOS Desktop app";

    inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";

    outputs = { self, nixpkgs }:
        let
            systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" "aarch64-linux" ];
            forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
        in {
            apps = forAllSystems (pkgs: {
                # fetch the backend's remote imports now so its first start is fast
                install = {
                    type = "app";
                    program = toString (pkgs.writeShellScript "install" ''
                        set -e
                        ${pkgs.deno}/bin/deno cache --no-lock dim/apps/urdf_view/main.js
                        echo "dim-urdf-editor: backend cached"
                    '');
                };
            });
        };
}
