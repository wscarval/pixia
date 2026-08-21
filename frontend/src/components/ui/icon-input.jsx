import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function IconInput({ icon: Icon, trailing, className, ...props }) {
  return (
    <div className="relative">
      <Icon
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        className={cn("h-11 rounded-xl bg-input/30 pl-10", trailing && "pr-11", className)}
        {...props}
      />
      {trailing}
    </div>
  );
}
