export function GoogleIcon({ size = 18 }) {
  return (
    <span className="google-button__mark" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" focusable="false">
        <path
          fill="#4285F4"
          d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.63h6.2a5.3 5.3 0 0 1-2.3 3.48v2.9h3.72c2.18-2 3.44-4.96 3.44-8.56Z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.11 0 5.72-1.03 7.62-2.79l-3.72-2.9c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.02-6.45-4.74H1.7v2.98A11.5 11.5 0 0 0 12 24Z"
        />
        <path
          fill="#FBBC05"
          d="M5.55 14.67a6.9 6.9 0 0 1 0-4.36V7.33H1.7a11.5 11.5 0 0 0 0 10.32l3.85-2.98Z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.69 0 3.2.58 4.4 1.72l3.3-3.3C17.7 1.3 15.1.25 12 .25A11.5 11.5 0 0 0 1.7 7.33l3.85 2.98C6.46 7.52 9 4.75 12 4.75Z"
        />
      </svg>
    </span>
  )
}

export function GoogleButton({ onClick, isLoading = false, label = 'Continue with Google' }) {
  return (
    <button type="button" className="google-button" onClick={onClick} disabled={isLoading}>
      <GoogleIcon />
      <span>{isLoading ? 'Connecting…' : label}</span>
    </button>
  )
}
