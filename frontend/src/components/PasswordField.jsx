import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { IconInput } from "@/components/ui/icon-input";
import { Button } from "@/components/ui/button";

export default function PasswordField({
  id,
  value,
  onChange,
  placeholder,
  maxLength = 128,
  autoFocus,
}) {
  const [visible, setVisible] = useState(false);

  return (
    <IconInput
      icon={Lock}
      id={id}
      type={visible ? "text" : "password"}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      maxLength={maxLength}
      autoFocus={autoFocus}
      trailing={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => setVisible((current) => !current)}
          tabIndex={-1}
          title={visible ? "Esconder senha" : "Mostrar senha"}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </Button>
      }
    />
  );
}
