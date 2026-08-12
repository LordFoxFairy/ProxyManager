import { cloneElement, type ButtonHTMLAttributes, type ReactElement } from 'react';

export function ActionGuard({
  locked,
  reason,
  onLocked,
  children,
}: {
  locked: boolean;
  reason: string;
  onLocked: () => void;
  children: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
}) {
  return cloneElement(children, {
    disabled: locked ? false : children.props.disabled,
    'aria-disabled': locked || undefined,
    title: locked ? reason : children.props.title,
    className: `${children.props.className ?? ''}${locked ? ' is-locked' : ''}`,
    onClick: locked
      ? (event) => {
          event.preventDefault();
          onLocked();
        }
      : children.props.onClick,
  });
}
