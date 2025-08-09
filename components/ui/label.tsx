'use client';
import * as React from 'react';
import { cn } from '@/components/ui/cn';
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm text-zinc-200', className)} {...props} />;
}
