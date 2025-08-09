'use client';
import * as React from 'react';
import { cn } from '@/components/ui/cn';
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (<textarea ref={ref} className={cn('input-dark rounded-md px-3 py-2 min-h-[120px]', className)} {...props} />)
);
Textarea.displayName = 'Textarea';
