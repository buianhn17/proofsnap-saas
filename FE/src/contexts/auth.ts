// Context + hook đăng nhập PTG. Provider nằm ở AuthContext.tsx (file chỉ export component
// để Fast Refresh của Vite hoạt động).
import { createContext, useContext } from "react";

export interface Photographer {
  id: string;
  email: string;
  display_name: string | null;
}

export interface AuthContextValue {
  photographer: Photographer | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải được dùng bên trong AuthProvider");
  return ctx;
}
