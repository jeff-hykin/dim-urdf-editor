{
    description = "dim-urdf-editor: view and edit robot URDFs, as a dimOS Desktop app (`nix build .#dimosApp`)";
    inputs = {
        nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
        # the page's deno: nixos-25.11's 2.6.10, the version dimos pins (unstable's newer deno refuses packages younger than a day)
        nixpkgs-deno.url = "github:NixOS/nixpkgs/nixos-25.11";
    };
    nixConfig = {
        extra-substituters = [ "https://dimos-desktop.cachix.org" ];
        extra-trusted-public-keys = [ "dimos-desktop.cachix.org-1:A4P35aGJGmCan92LWyamtSFXMqaVE+VRFYnrJ8QMTeQ=" ];
    };
    outputs = { self, nixpkgs, nixpkgs-deno }:
        let
            systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" "aarch64-linux" ];
            forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
            # bin/dimos-app-server for <arch> Linux, written on any machine: its bash and deno are the target's (cache.nixos.org downloads, nothing built)
            linuxApp = pkgs: arch: line:
                let linux = nixpkgs.legacyPackages."${arch}-linux"; in
                pkgs.writeTextFile {
                    name = "dimos-app-server-${arch}-linux";
                    destination = "/bin/dimos-app-server";
                    executable = true;
                    text = "#!${linux.runtimeShell}\n${line linux}\n";
                };
        in {
            packages = forAll (pkgs:
                let
                    deno = nixpkgs-deno.legacyPackages.${pkgs.stdenv.hostPlatform.system}.deno;
                    denoEnv = "export HOME=$TMPDIR DENO_DIR=$TMPDIR/deno DENO_NO_UPDATE_CHECK=1 DENO_NO_PROMPT=1";
                    frontendFiles = paths: pkgs.lib.fileset.toSource { root = ./frontend; fileset = pkgs.lib.fileset.unions paths; };
                    # `deno install --frozen` (deno.lock pins every package) with network, so fixed-output. Its hash is per
                    # build machine (vite's native rollup and esbuild differ by OS and CPU): `deno task update-hashes` refreshes
                    # this machine's after frontend/deno.json or deno.lock change.
                    frontendModules = pkgs.stdenvNoCC.mkDerivation {
                        name = "dim-urdf-editor-frontend-modules";
                        src = frontendFiles [ ./frontend/deno.json ./frontend/deno.lock ];
                        nativeBuildInputs = [ deno ];
                        buildPhase = ''
                            ${denoEnv}
                            export SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
                            deno install --frozen
                            # deno's own record of the install: not needed, and not byte-identical between installs
                            rm -f node_modules/.deno/.setup-cache.bin
                        '';
                        installPhase = "cp -R node_modules $out";
                        dontFixup = true;
                        outputHashMode = "recursive";
                        outputHashAlgo = "sha256";
                        outputHash = {
                            aarch64-darwin = "sha256-oO+P8sfp+UkDIpcmAzY4FqTDhNeop0Y4AHHbxGjwf+Q=";
                            x86_64-darwin = "";
                            x86_64-linux = "sha256-UHGas9HqIgcuMMgGITTDW7mGb93EZH7dw7TW0SpmCJw=";
                            aarch64-linux = "";
                        }.${pkgs.stdenv.hostPlatform.system};
                    };

                    pageFiles = frontendFiles [ ./frontend/deno.json ./frontend/deno.lock ./frontend/tsconfig.json ./frontend/index.html ./frontend/vite.config.ts ./frontend/tools ./frontend/src ];
                    # dimos-react as esm.sh builds its tag (frontend/tools/esm_fetch.ts): a vite build with network that
                    # keeps only what it fetched, so fixed-output; the same on every system. `deno task update-hashes` refreshes it.
                    frontendEsm = pkgs.stdenvNoCC.mkDerivation {
                        name = "dim-urdf-editor-frontend-esm";
                        src = pageFiles;
                        nativeBuildInputs = [ deno ];
                        buildPhase = ''
                            ${denoEnv}
                            export SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
                            cp -R ${frontendModules} node_modules
                            chmod -R u+w node_modules
                            ESM_CACHE=$TMPDIR/esm deno run -A --cached-only --node-modules-dir=manual npm:vite build --logLevel warn
                        '';
                        installPhase = "cp -R $TMPDIR/esm $out";
                        dontFixup = true;
                        outputHashMode = "recursive";
                        outputHashAlgo = "sha256";
                        outputHash = "sha256-i1apDkHmXSVopbvBbhYKHWqaKqD1yKvh9W+2KnSRFAc=";
                    };

                    # the page: React + Vite against those modules and that esm.sh cache, offline
                    frontend = pkgs.stdenvNoCC.mkDerivation {
                        name = "dim-urdf-editor-frontend";
                        src = pageFiles;
                        nativeBuildInputs = [ deno ];
                        buildPhase = ''
                            ${denoEnv}
                            cp -R ${frontendModules} node_modules
                            chmod -R u+w node_modules
                            ESM_CACHE=${frontendEsm} ESM_OFFLINE=1 deno run -A --cached-only --node-modules-dir=manual npm:vite build
                        '';
                        installPhase = "cp -R dist $out";
                    };
                in
                rec {
                inherit frontend frontendModules frontendEsm;
                dimosApp = pkgs.writeShellScriptBin "dimos-app-server" ''
                    exec ${pkgs.deno}/bin/deno run -A --no-lock ${./backend}/main.ts --frontend ${frontend} "$@"
                '';
                default = dimosApp;
                # the frontend is plain JS, so the same build serves every target
                dimosApp-aarch64-linux = linuxApp pkgs "aarch64" (linux: "exec ${linux.deno}/bin/deno run -A --no-lock ${./backend}/main.ts --frontend ${frontend} \"$@\"");
                dimosApp-x86_64-linux = linuxApp pkgs "x86_64" (linux: "exec ${linux.deno}/bin/deno run -A --no-lock ${./backend}/main.ts --frontend ${frontend} \"$@\"");
            });
        };
}
