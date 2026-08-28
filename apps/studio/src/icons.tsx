type IconProps = {
  className?: string;
};

type ProductIconProps = IconProps & {
  name:
    | "add"
    | "chevron-down"
    | "chevron-right"
    | "close"
    | "debug-restart"
    | "folder"
    | "folder-opened"
    | "lock"
    | "preview"
    | "play"
    | "save"
    | "terminal"
    | "unmute";
};

export function ProductIcon({ className, name }: ProductIconProps) {
  return <span aria-hidden="true" className={`codicon codicon-${name}${className === undefined ? "" : ` ${className}`}`} />;
}

export function AddIcon(props: IconProps) {
  return <ProductIcon {...props} name="add" />;
}

export function ChevronDownIcon(props: IconProps) {
  return <ProductIcon {...props} name="chevron-down" />;
}

export function ChevronRightIcon(props: IconProps) {
  return <ProductIcon {...props} name="chevron-right" />;
}

export function FolderIcon(props: IconProps) {
  return <ProductIcon {...props} name="folder" />;
}

export function FolderOpenIcon(props: IconProps) {
  return <ProductIcon {...props} name="folder-opened" />;
}

export function MonitorIcon(props: IconProps) {
  return <ProductIcon {...props} name="preview" />;
}

export function LockIcon(props: IconProps) {
  return <ProductIcon {...props} name="lock" />;
}

export function ReplayIcon(props: IconProps) {
  return <ProductIcon {...props} name="debug-restart" />;
}

export function RunIcon(props: IconProps) {
  return <ProductIcon {...props} name="play" />;
}

export function SaveIcon(props: IconProps) {
  return <ProductIcon {...props} name="save" />;
}

export function TerminalIcon(props: IconProps) {
  return <ProductIcon {...props} name="terminal" />;
}

export function VolumeIcon(props: IconProps) {
  return <ProductIcon {...props} name="unmute" />;
}

export function XIcon(props: IconProps) {
  return <ProductIcon {...props} name="close" />;
}
