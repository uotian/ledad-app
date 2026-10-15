import type { ButtonHTMLAttributes } from 'react';
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  small?: boolean;
};
export default function Button({
  variant = 'secondary',
  small = false,
  className = '',
  ...props
}: Props) {
  return (
    <button
      type="button"
      className={`button button-${variant} ${small ? 'button-small' : ''} ${className}`}
      {...props}
    />
  );
}
