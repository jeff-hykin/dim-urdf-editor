{
    description = "dim-urdf-editor: view and edit robot URDFs, as a dimOS Desktop app";

    inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    inputs.dim-app.url = "github:jeff-hykin/dim-app/v0.5.0";

    outputs = { self, nixpkgs, dim-app }: {
        packages = dim-app.lib.forAllSystems nixpkgs (pkgs: {
            dimosApp = dim-app.lib.mkDimosApp {
                inherit pkgs;
                name = "dim-urdf-editor";
                src = self;
                frontend = "dim/apps/urdf_view/frontend";
                backend = "dim/apps/urdf_view/main.js";
            };
        });
    };
}
