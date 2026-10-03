export interface LoginProps {
  onLogin: (email: string, password: string) => Promise<void>;
}
