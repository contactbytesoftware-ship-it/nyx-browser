interface CredentialBannerAction {
  label: string
  onClick: () => void
  primary?: boolean
}

interface CredentialBannerProps {
  message: string
  actions: CredentialBannerAction[]
}

export default function CredentialBanner({ message, actions }: CredentialBannerProps): JSX.Element {
  return (
    <div className="credential-banner">
      <span className="credential-banner-message">{message}</span>
      {actions.map((action) => (
        <button
          key={action.label}
          className={action.primary ? 'credential-banner-primary' : 'credential-banner-secondary'}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
