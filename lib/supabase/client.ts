import { createBrowserClient } from '@supabase/ssr'
import { Database } from '@/lib/database.types'

export const createClient = () => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Return a dummy client or undefined to prevent build crashes when env vars are missing
    // validating the assumption that this only happens during build/static generation
    return createBrowserClient<Database>(
      'https://placeholder.supabase.co',
      'placeholder',
    )
  }

  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}
