'use client';
import * as React from 'react';
import { cn } from '@/components/ui/cn';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (<input ref={ref} className={cn('input-dark h-10 px-3 rounded-md', className)} {...props} />)
);
Input.displayName = 'Input';
