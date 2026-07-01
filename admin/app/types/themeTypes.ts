export type ThemeCallback = (isDark: boolean) => void;

export interface ThemeColors {
  background: string;
  cardBackground: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  borderColor: string;
  success: string;
  error: string;
  warning: string;
  info: string;
  shadow: string;
  inputBackground: string;
  inputBorder: string;
  inputFocus: string;
  buttonPrimary: string;
  buttonPrimaryHover: string;
  buttonSecondary: string;
  buttonDanger: string;
  buttonDangerHover: string;
}
