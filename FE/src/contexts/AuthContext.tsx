import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { AuthContext, type Photographer } from "./auth";

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

  // Tải phiên đăng nhập khi mở app. setState chỉ chạy trong callback của promise (không đồng
  // bộ trong effect), có cờ huỷ khi Provider bị gỡ.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ photographer: Photographer }>("/api/auth/me")
      .then(({ data }) => !cancelled && setPhotographer(data.photographer))
      .catch(() => !cancelled && setPhotographer(null))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
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
