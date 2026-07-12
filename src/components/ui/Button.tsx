import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}

export function Button({ icon, children, className = '', variant = 'secondary', ...props }: ButtonProps) {
  return <button type={props.type ?? 'button'} className={`button button-${variant} ${className}`} {...props}>{icon}{children && <span>{children}</span>}</button>
}
