import { cn } from "~/lib/utils";

export function Alert({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "destructive" | "success" }) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border px-4 py-3 text-sm",
        variant === "destructive" && "border-destructive/40 bg-destructive/10 text-destructive",
        variant === "success" && "border-green-600/30 bg-green-600/10 text-green-800",
        variant === "default" && "border-border bg-muted text-foreground",
        className,
      )}
      {...props}
    />
  );
}
