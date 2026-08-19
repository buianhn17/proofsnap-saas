import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/api";

interface Photographer {
  id: string;
  email: string;
  display_name: string | null;
}

interface AuthContextValue {
  photographer: Photographer | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [photographer, setPhotographer] = useState<Photographer | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function refresh() {
    try {
      const { data } = await api.get<{ photographer: Photographer }>(
        "/api/auth/me"
      );
      setPhotographer(data.photographer);
    } catch {
      setPhotographer(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function logout() {
    await api.post("/api/auth/logout");
    setPhotographer(null);
  }

  return (
    <AuthContext.Provider value={{ photographer, isLoading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải được dùng bên trong AuthProvider");
  return ctx;
}
