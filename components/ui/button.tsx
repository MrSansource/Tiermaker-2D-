'use client';
import * as React from 'react';
import { cn } from '@/components/ui/cn';
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default'|'secondary'|'outline'|'destructive'; size?: 'sm'|'md'|'lg'|'icon'; };
export function Button({ className, variant='default', size='md', ...props }: BtnProps) {
  const base = 'inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';
  const variants: Record<string,string> = {
    default: 'bg-indigo-600 text-white hover:bg-indigo-500 focus:ring-indigo-500',
    secondary: 'bg-zinc-700 text-zinc-100 hover:bg-zinc-600 focus:ring-zinc-500',
    outline: 'btn-outline-dark',
    destructive: 'bg-red-600 text-white hover:bg-red-500 focus:ring-red-500',
  };
  const sizes: Record<string,string> = { sm:'h-8 px-3 text-sm', md:'h-10 px-4 text-sm', lg:'h-12 px-6 text-base', icon:'h-10 w-10' };
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}
