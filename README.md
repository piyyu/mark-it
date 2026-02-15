<div align="center">
  <img src="public/logo.svg" alt="Markit Logo" width="80" />
  <h3>Markit</h3>
  <p><strong>Your bookmarks, beautifully organized.</strong></p>
  <p>
    A simple, secure, and real-time bookmark manager.<br/>
    Built with Next.js 14, Supabase, and Tailwind CSS.
  </p>
  <p>
    <a href="https://mark-it-mi76.vercel.app"><strong>View Live Demo</strong></a>
  </p>
</div>


#### Requirements Checklist

| # | Requirement | Status |
|---|---|:---:|
| 1 | User can sign up and log in using Google (OAuth only) | ✅ |
| 2 | Logged-in user can add a bookmark (URL + title) | ✅ |
| 3 | Bookmarks are private to each user (RLS enforced) | ✅ |
| 4 | Bookmark list updates in real-time (no page refresh) | ✅ |
| 5 | User can delete their own bookmarks | ✅ |
| 6 | App deployed on Vercel with a working live URL | ✅ |

#### Tech Stack

- **Framework:** Next.js 16 (App Router, not Pages Router)
- **Database:** Supabase (Auth, Postgres Database, Realtime)
- **Styling:** Tailwind CSS 4
- **Language:** TypeScript

#### Features

- **Folder organization** — color-coded folders to group bookmarks
- **Favorites** — star bookmarks for quick access
- **Search** — instant full-text search across titles and URLs
- **Dark mode** — beautiful light/dark theme toggle
- **Grid & list views** — toggle between card grid and compact list
- **Move to folder** — organize bookmarks into folders with one click
- **Responsive design** — works on desktop, tablet, and mobile

#### Challenges & Solutions

#### 1. Hydration Mismatch Error on `<body>` Tag

**Problem:** React threw a hydration mismatch warning because browser extensions (like Grammarly) inject custom attributes into the `<body>` element during client-side rendering, causing a mismatch with the server-rendered HTML.

**Solution:** Added `suppressHydrationWarning` to the `<body>` tag in `app/layout.tsx`. This tells React to ignore attribute differences on that element — a standard pattern when using `next-themes` or when browser extensions modify the DOM.

#### 2. Double Folder Creation (Real-Time + Optimistic UI Conflict)

**Problem:** When creating a folder, it appeared twice in the sidebar. This happened because:
1. The optimistic update immediately added a temp folder to the list.
2. Supabase's real-time subscription then fired an `INSERT` event and added the same folder again (with its real database ID).

**Solution:** Added deduplication logic to the real-time folder subscription handler. When the real-time event arrives, it checks if a folder with the same `name` + `color` already exists (the temp one) and replaces it with the real database version. If the exact `id` already exists, it skips entirely.

#### 3. Missing Database Columns (`folder_id`, `is_favorite`)

**Problem:** After adding folder and favorites features in the code, the Supabase `bookmarks` table didn't have the corresponding `folder_id` and `is_favorite` columns, causing errors like:
> "Could not find the 'folder_id' column of 'bookmarks' in the schema cache"

**Solution:** Ran an `ALTER TABLE` migration to add both columns:
```sql
ALTER TABLE bookmarks
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;
```

#### 4. Nested `<button>` Inside `<button>` Hydration Error

**Problem:** The folder items in the sidebar had edit/delete buttons nested inside a clickable `<button>` parent, which is invalid HTML and triggers React hydration errors.

**Solution:** Changed the parent wrapper from `<button>` to a `<div>` with `role="button"` and `onClick`, while keeping the child action buttons as actual `<button>` elements. Added `e.stopPropagation()` on child buttons to prevent event bubbling.

#### 5. Inconsistent Cursor Styles Across Interactive Elements

**Problem:** Some buttons and clickable elements showed the default cursor instead of the pointer cursor, making the UI feel inconsistent.

**Solution:** Added global CSS rules in `globals.css` to automatically set `cursor: pointer` on all `button`, `a`, and `[role="button"]` elements, and `cursor: not-allowed` on disabled buttons. This eliminated the need to add `cursor-pointer` to every individual element.

#### Setup Instructions

#### 1. Prerequisites
- Node.js 18+
- A Supabase project

#### 2. Environment Variables
```bash
cp .env.example .env.local
```
Update `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

#### 3. Database Setup
Run the following SQL in the Supabase SQL Editor:

```sql
-- Create folders table (must be created first for foreign key)
CREATE TABLE folders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#FF1B6D',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create bookmarks table
CREATE TABLE bookmarks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  is_favorite BOOLEAN DEFAULT false,
  folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

-- Bookmarks policies
CREATE POLICY "Users can view their own bookmarks" ON bookmarks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own bookmarks" ON bookmarks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own bookmarks" ON bookmarks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own bookmarks" ON bookmarks FOR DELETE USING (auth.uid() = user_id);

-- Folders policies
CREATE POLICY "Users can view their own folders" ON folders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own folders" ON folders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own folders" ON folders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own folders" ON folders FOR DELETE USING (auth.uid() = user_id);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE bookmarks;
ALTER PUBLICATION supabase_realtime ADD TABLE folders;
```

#### 4. Configure Google OAuth
1. Go to Supabase → **Authentication** → **Providers** → Enable **Google**
2. Add Google OAuth credentials (Client ID + Secret)
3. Set redirect URL: `http://localhost:3000/auth/callback`

#### 5. Install & Run
```bash
npm install
npm run dev
```

#### Deployment

1. Push code to GitHub
2. Import project into Vercel
3. Add environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
4. Update Google OAuth redirect URL in Supabase to: `https://your-domain.vercel.app/auth/callback`
5. Deploy!

#### Project Structure

```
smart-bookmark-app/
├── app/
│   ├── auth/
│   │   ├── callback/route.ts    # OAuth callback handler
│   │   └── signout/route.ts     # Sign out handler
│   ├── dashboard/page.tsx       # Dashboard page
│   ├── login/page.tsx           # Login page
│   ├── page.tsx                 # Landing page
│   ├── layout.tsx               # Root layout
│   ├── providers.tsx            # Theme provider
│   └── globals.css              # Global styles
├── components/
│   ├── AddBookmarkModal.tsx     # Add bookmark modal
│   ├── AuthButton.tsx           # Google sign-in button
│   ├── BookmarkCard.tsx         # Bookmark card component
│   ├── DashboardShell.tsx       # Main dashboard layout
│   ├── LandingGoogleButton.tsx  # Landing page CTA button
│   └── ThemeToggle.tsx          # Light/dark mode toggle
├── lib/
│   ├── database.types.ts        # Supabase type definitions
│   ├── utils.ts                 # Utility functions
│   └── supabase/
│       ├── client.ts            # Supabase browser client
│       ├── server.ts            # Supabase server client
│       └── middleware.ts        # Auth middleware
└── public/
    └── logo.svg                 # App logo
```

#### License

This project is open source and available under the [MIT License](LICENSE).

<div align="center">

Built with ❤️ using Next.js and Supabase

</div>
