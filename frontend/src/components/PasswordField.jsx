import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

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
    <div className="input-group password-group">
      <Lock size={16} />
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((current) => !current)}
        tabIndex={-1}
        title={visible ? "Esconder senha" : "Mostrar senha"}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
