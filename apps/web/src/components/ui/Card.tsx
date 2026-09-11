'use client';

import React from 'react';

interface DivProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Tabler `.card` container.
 */
export function Card({
  children,
  className = '',
  ...rest
}: DivProps) {
  return (
    <div className={`card${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '', ...rest }: DivProps) {
  return (
    <div className={`card-header${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </div>
  );
}

export function CardBody({ children, className = '', ...rest }: DivProps) {
  return (
    <div className={`card-body${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className = '', ...rest }: DivProps) {
  return (
    <div className={`card-footer${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </div>
  );
}

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode;
}

export function CardTitle({ children, className = '', ...rest }: CardTitleProps) {
  return (
    <h3 className={`card-title${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </h3>
  );
}

export default Card;