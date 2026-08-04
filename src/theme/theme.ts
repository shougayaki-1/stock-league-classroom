import { createTheme } from '@mui/material/styles'

export const appTheme = createTheme({
  cssVariables: true,
  palette: {
    primary: { main: '#1a73e8', dark: '#0842a0', light: '#d3e3fd', contrastText: '#ffffff' },
    secondary: { main: '#5f6368' },
    error: { main: '#d93025', light: '#fce8e6' },
    warning: { main: '#f29900', light: '#fef7e0' },
    success: { main: '#1e8e3e', light: '#e6f4ea' },
    background: { default: '#f1f3f4', paper: '#ffffff' },
    text: { primary: '#1f1f1f', secondary: '#5f6368' },
    divider: '#dadce0',
  },
  shape: { borderRadius: 12 },
  spacing: 8,
  typography: {
    fontFamily: 'Roboto, "Noto Sans JP", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    h1: { fontSize: 'clamp(2rem, 4vw, 3.25rem)', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.035em' },
    h2: { fontSize: 'clamp(1.5rem, 2.5vw, 2rem)', fontWeight: 700, lineHeight: 1.25, letterSpacing: '-0.02em' },
    h3: { fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.35 },
    button: { fontWeight: 700, textTransform: 'none', letterSpacing: 0 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { minWidth: 320, backgroundColor: '#f1f3f4' },
        'a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible': {
          outline: '3px solid #1a73e8',
          outlineOffset: 2,
        },
      },
    },
    MuiButtonBase: { defaultProps: { disableRipple: false } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minWidth: 72, minHeight: 44, borderRadius: 22, paddingInline: 20, whiteSpace: 'nowrap', flexShrink: 0 },
        sizeSmall: { minHeight: 36, paddingInline: 16 },
        sizeLarge: { minHeight: 48, borderRadius: 24, paddingInline: 24 },
      },
    },
    MuiIconButton: { styleOverrides: { root: { minWidth: 48, minHeight: 48 } } },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderColor: '#e8eaed' } } },
    MuiPaper: { styleOverrides: { rounded: { borderRadius: 16 } } },
    MuiTextField: { defaultProps: { variant: 'outlined', size: 'medium' } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 12 } } },
    MuiDialog: { defaultProps: { fullWidth: true, maxWidth: 'sm' } },
    MuiLink: { defaultProps: { underline: 'hover' } },
  },
})
