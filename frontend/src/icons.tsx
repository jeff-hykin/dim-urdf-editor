// The shared dimOS line icons this app uses (24-unit grid, stroke = currentColor; styled by theme.css .dim-icon).
const PATHS = {
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    close: "M6 6l12 12M18 6 6 18",
    trash: "M5 7h14M10 7V4h4v3m-7 0 1 13h8l1-13",
    "rotate-left": "M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5",
}

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS; size?: number }) {
    return (
        <svg className="dim-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path d={PATHS[name]} />
        </svg>
    )
}
