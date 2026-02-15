'use client';

import { createClient } from '@/lib/supabase/client';
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { Database } from '@/lib/database.types';
import type { User } from '@supabase/supabase-js';
import BookmarkCard from './BookmarkCard';
import AddBookmarkModal from './AddBookmarkModal';
import ThemeToggle from './ThemeToggle';

type Bookmark = Database['public']['Tables']['bookmarks']['Row'];
type Folder = Database['public']['Tables']['folders']['Row'];

type NavItem = 'all' | 'favorites' | 'folder';

interface DashboardShellProps {
  initialBookmarks: Bookmark[];
  initialFolders: Folder[];
  user: User | null;
}

export default function DashboardShell({ initialBookmarks, initialFolders, user }: DashboardShellProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(initialBookmarks);
  const [folders, setFolders] = useState<Folder[]>(initialFolders);
  const [activeNav, setActiveNav] = useState<NavItem>('all');
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#FF1B6D');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [editFolderColor, setEditFolderColor] = useState('');
  const [localFavorites, setLocalFavorites] = useState<Set<string>>(new Set());

  // Load local favorites on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('markit_favorites');
      if (stored) {
        setLocalFavorites(new Set(JSON.parse(stored)));
      }
    } catch (e) {
      console.error('Failed to load local favorites:', e);
    }
  }, []);

  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;

  // Real-time subscription for bookmarks
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-bookmarks')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookmarks' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setBookmarks((prev) => {
              if (prev.some(b => b.id === payload.new.id)) return prev;
              return [payload.new as Bookmark, ...prev];
            });
          } else if (payload.eventType === 'DELETE') {
            setBookmarks((prev) => prev.filter((b) => b.id !== payload.old.id));
          } else if (payload.eventType === 'UPDATE') {
            setBookmarks((prev) =>
              prev.map((b) => (b.id === payload.new.id ? (payload.new as Bookmark) : b))
            );
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  // Real-time subscription for folders
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-folders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'folders' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setFolders((prev) => [...prev, payload.new as Folder]);
          } else if (payload.eventType === 'DELETE') {
            setFolders((prev) => prev.filter((f) => f.id !== payload.old.id));
          } else if (payload.eventType === 'UPDATE') {
            setFolders((prev) =>
              prev.map((f) => (f.id === payload.new.id ? (payload.new as Folder) : f))
            );
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  // CRUD operations
  const handleDelete = useCallback(async (id: string) => {
    const prev = [...bookmarks];
    setBookmarks(bookmarks.filter((b) => b.id !== id));
    const { error } = await supabase.from('bookmarks').delete().eq('id', id);
    if (error) setBookmarks(prev);
  }, [bookmarks, supabase]);

  const handleToggleFavorite = useCallback(async (id: string, current: boolean) => {
    // Optimistic update
    setBookmarks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, is_favorite: !current } : b))
    );

    try {
      const { error } = await supabase
        .from('bookmarks')
        .update({ is_favorite: !current })
        .eq('id', id);

      if (error) {
        throw error;
      }
    } catch (err) {
      console.error('Error toggling favorite (falling back to local storage):', err);
      // @ts-ignore
      if (err?.message) console.error('Error message:', err.message);
      // @ts-ignore
      if (err?.details) console.error('Error details:', err.details);
      // @ts-ignore
      if (err?.hint) console.error('Error hint:', err.hint);
      // Fallback: update local storage
      setLocalFavorites((prev) => {
        const next = new Set(prev);
        if (!current) {
          next.add(id);
        } else {
          next.delete(id);
        }
        localStorage.setItem('markit_favorites', JSON.stringify([...next]));
        return next;
      });
      // Do NOT revert the optimistic update in bookmarks state,
      // because effectiveBookmarks will pick up the change from localFavorites
    }
  }, [supabase]);

  const handleBookmarkAdded = useCallback((newBookmark: Bookmark) => {
    setBookmarks((prev) => {
      if (prev.some(b => b.id === newBookmark.id)) return prev;
      return [newBookmark, ...prev];
    });
  }, []);

  const handleAddFolder = async () => {
    if (!newFolderName.trim()) return;

    const folderName = newFolderName.trim();
    const folderColor = newFolderColor;

    // Optimistic local folder so it appears immediately
    const tempId = crypto.randomUUID();
    const tempFolder: Folder = {
      id: tempId,
      user_id: user?.id || '',
      name: folderName,
      color: folderColor,
      created_at: new Date().toISOString(),
    };
    setFolders((prev) => [...prev, tempFolder]);
    setNewFolderName('');
    setNewFolderColor('#FF1B6D');
    setShowAddFolder(false);

    // Insert into database
    const response = await supabase.from('folders').insert({
      name: folderName,
      color: folderColor,
      user_id: user?.id,
    });

    if (response.status !== 201) {
      console.error('Failed to create folder:', response.status, response.error);
      setFolders((prev) => prev.filter((f) => f.id !== tempId));
    }
  };

  const startEditingFolder = (folder: Folder) => {
    setEditingFolderId(folder.id);
    setEditFolderName(folder.name);
    setEditFolderColor(folder.color);
  };

  const handleUpdateFolder = async () => {
    if (!editingFolderId || !editFolderName.trim()) return;

    const folderId = editingFolderId;
    const newName = editFolderName.trim();
    const newColor = editFolderColor;

    // Optimistic update
    setFolders((prev) =>
      prev.map((f) => f.id === folderId ? { ...f, name: newName, color: newColor } : f)
    );
    setEditingFolderId(null);

    const response = await supabase
      .from('folders')
      .update({ name: newName, color: newColor })
      .eq('id', folderId);

    if (response.status !== 204) {
      console.error('Failed to update folder:', response.status, response.error);
    }
  };

  const handleMoveBookmark = useCallback(async (bookmarkId: string, folderId: string | null) => {
    // Optimistic update
    setBookmarks((prev) =>
      prev.map((b) => b.id === bookmarkId ? { ...b, folder_id: folderId } : b)
    );

    const response = await supabase
      .from('bookmarks')
      .update({ folder_id: folderId })
      .eq('id', bookmarkId);

    if (response.status !== 204) {
      console.error('Failed to move bookmark:', response.status, response.error);
    }
  }, [supabase]);

  const handleDeleteFolder = async (id: string) => {
    // Optimistic removal
    setFolders((prev) => prev.filter((f) => f.id !== id));
    if (activeFolderId === id) {
      setActiveNav('all');
      setActiveFolderId(null);
    }
    const { error } = await supabase.from('folders').delete().eq('id', id);
    if (error) {
      console.error('Error deleting folder:', error);
    }
  };

  const handleSignOut = async () => {
    await fetch('/auth/signout', { method: 'POST' });
    window.location.href = '/login';
  };

  // Merge API data with local favorites
  const effectiveBookmarks = useMemo(() => {
    return bookmarks.map((b) => ({
      ...b,
      is_favorite: b.is_favorite || localFavorites.has(b.id),
    }));
  }, [bookmarks, localFavorites]);

  // Filtered bookmarks
  const filteredBookmarks = useMemo(() => {
    let filtered = effectiveBookmarks;

    if (activeNav === 'favorites') {
      filtered = filtered.filter((b) => b.is_favorite);
    } else if (activeNav === 'folder' && activeFolderId) {
      filtered = filtered.filter((b) => b.folder_id === activeFolderId);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [effectiveBookmarks, activeNav, activeFolderId, searchQuery]);

  // Folder bookmark counts
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    bookmarks.forEach((b) => {
      if (b.folder_id) counts[b.folder_id] = (counts[b.folder_id] || 0) + 1;
    });
    return counts;
  }, [bookmarks]);

  const favCount = useMemo(() => effectiveBookmarks.filter((b) => b.is_favorite).length, [effectiveBookmarks]);

  const activeTitle = activeNav === 'favorites'
    ? 'Favorites'
    : activeNav === 'folder'
      ? folders.find((f) => f.id === activeFolderId)?.name || 'Folder'
      : 'All Bookmarks';

  const folderColors = ['#FF1B6D', '#3B82F6', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#EF4444', '#06B6D4'];

  return (
    <div className="font-sans bg-landing-background-light dark:bg-landing-background-dark text-landing-forest dark:text-white min-h-screen flex selection:bg-landing-primary selection:text-white">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:sticky top-0 left-0 z-50 lg:z-auto
        w-72 lg:w-64 h-screen flex-shrink-0 flex flex-col
        bg-white/80 dark:bg-[#0A0A0A]/90 backdrop-blur-xl
        border-r border-landing-forest/5 dark:border-white/5
        transform transition-transform duration-300 lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5 group cursor-pointer">
            <div className="w-8 h-8 bg-landing-primary rounded-lg flex items-center justify-center shadow-lg shadow-landing-primary/20 group-hover:rotate-3 transition-transform">
              <span className="material-icons text-white text-lg">bookmark</span>
            </div>
            <span className="text-lg font-bold tracking-tight">Markit</span>
          </div>
          <button className="lg:hidden p-1" onClick={() => setSidebarOpen(false)}>
            <span className="material-icons text-landing-forest/40 dark:text-white/40">close</span>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-1 overflow-y-auto custom-scrollbar space-y-6">
          <div>
            <p className="px-3 mb-2 text-[10px] font-bold text-landing-forest/35 dark:text-white/25 uppercase tracking-[0.15em]">Navigation</p>
            <div className="space-y-0.5">
              <button
                onClick={() => { setActiveNav('all'); setActiveFolderId(null); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${activeNav === 'all'
                  ? 'bg-landing-primary/10 text-landing-primary'
                  : 'text-landing-forest/55 dark:text-white/55 hover:bg-landing-forest/[0.04] dark:hover:bg-white/[0.04] hover:text-landing-forest/80 dark:hover:text-white/80'
                  }`}
              >
                <span className={`material-icons text-lg ${activeNav === 'all' ? 'text-landing-primary' : ''}`}>inbox</span>
                All Bookmarks
                <span className="ml-auto text-xs tabular-nums opacity-50">{effectiveBookmarks.length}</span>
              </button>
              <button
                onClick={() => { setActiveNav('favorites'); setActiveFolderId(null); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${activeNav === 'favorites'
                  ? 'bg-landing-primary/10 text-landing-primary'
                  : 'text-landing-forest/55 dark:text-white/55 hover:bg-landing-forest/[0.04] dark:hover:bg-white/[0.04] hover:text-landing-forest/80 dark:hover:text-white/80'
                  }`}
              >
                <span className={`material-icons text-lg ${activeNav === 'favorites' ? 'text-landing-primary' : ''}`}>
                  {activeNav === 'favorites' ? 'star' : 'star_border'}
                </span>
                Favorites
                {favCount > 0 && <span className="ml-auto text-xs tabular-nums opacity-50">{favCount}</span>}
              </button>
            </div>
          </div>

          {/* Folders */}
          <div className="pt-2 border-t border-landing-forest/5 dark:border-white/5">
            <div className="flex items-center justify-between px-3 mb-2">
              <p className="text-[10px] font-bold text-landing-forest/35 dark:text-white/25 uppercase tracking-[0.15em]">Folders</p>
              <button
                onClick={() => setShowAddFolder(!showAddFolder)}
                className="text-landing-forest/30 dark:text-white/30 hover:text-landing-primary transition-colors"
              >
                <span className="material-icons text-base">{showAddFolder ? 'close' : 'add'}</span>
              </button>
            </div>

            {/* Add folder form */}
            {showAddFolder && (
              <div className="mx-2 mb-3 p-3 bg-landing-forest/[0.03] dark:bg-white/[0.03] rounded-xl border border-landing-forest/5 dark:border-white/5">
                <input
                  type="text"
                  placeholder="Folder name"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddFolder()}
                  className="w-full bg-transparent text-sm outline-none placeholder:text-landing-forest/30 dark:placeholder:text-white/30 mb-2"
                  autoFocus
                />
                <div className="flex items-center gap-1.5 mb-2">
                  {folderColors.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewFolderColor(c)}
                      className={`w-5 h-5 rounded-full transition-all ${newFolderColor === c ? 'ring-2 ring-offset-1 ring-offset-landing-background-light dark:ring-offset-landing-background-dark scale-110' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <button
                  onClick={handleAddFolder}
                  disabled={!newFolderName.trim()}
                  className="w-full text-xs font-semibold text-white bg-landing-primary rounded-lg py-1.5 hover:bg-landing-primary/90 disabled:opacity-40 transition-all"
                >
                  Create Folder
                </button>
              </div>
            )}

            <div className="space-y-0.5">
              {folders.map((folder) => (
                <div key={folder.id} className="group relative">
                  {editingFolderId === folder.id ? (
                    <div className="mx-0 p-2.5 bg-landing-forest/[0.03] dark:bg-white/[0.03] rounded-xl border border-landing-forest/5 dark:border-white/5">
                      <input
                        type="text"
                        value={editFolderName}
                        onChange={(e) => setEditFolderName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateFolder(); if (e.key === 'Escape') setEditingFolderId(null); }}
                        className="w-full bg-transparent text-sm outline-none placeholder:text-landing-forest/30 dark:placeholder:text-white/30 mb-2"
                        autoFocus
                      />
                      <div className="flex items-center gap-1.5 mb-2">
                        {folderColors.map((c) => (
                          <button
                            key={c}
                            onClick={() => setEditFolderColor(c)}
                            className={`w-4 h-4 rounded-full transition-all ${editFolderColor === c ? 'ring-2 ring-offset-1 ring-offset-landing-background-light dark:ring-offset-landing-background-dark scale-110' : 'hover:scale-110'}`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={handleUpdateFolder}
                          disabled={!editFolderName.trim()}
                          className="flex-1 text-[10px] font-semibold text-white bg-landing-primary rounded-md py-1 hover:bg-landing-primary/90 disabled:opacity-40 transition-all"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingFolderId(null)}
                          className="flex-1 text-[10px] font-semibold text-landing-forest/50 dark:text-white/40 border border-landing-forest/10 dark:border-white/10 rounded-md py-1 hover:bg-landing-forest/[0.03] transition-all"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => { setActiveNav('folder'); setActiveFolderId(folder.id); setSidebarOpen(false); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setActiveNav('folder'); setActiveFolderId(folder.id); setSidebarOpen(false); } }}
                      className={`w-full h-9 rounded-lg flex items-center justify-between px-3 transition-all duration-200 cursor-pointer ${activeNav === 'folder' && activeFolderId === folder.id
                        ? 'bg-landing-primary/10 text-landing-primary'
                        : 'text-landing-forest/55 dark:text-white/55 hover:bg-landing-forest/[0.04] dark:hover:bg-white/[0.04]'
                        }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: folder.color }} />
                        <span className="text-sm truncate">{folder.name}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="text-[10px] tabular-nums opacity-40">{folderCounts[folder.id] || 0}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); startEditingFolder(folder); }}
                          className="opacity-0 group-hover:opacity-100 text-landing-forest/30 dark:text-white/30 hover:text-landing-primary transition-all p-0.5"
                        >
                          <span className="material-icons text-sm">edit</span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                          className="opacity-0 group-hover:opacity-100 text-landing-forest/30 dark:text-white/30 hover:text-red-500 transition-all p-0.5"
                        >
                          <span className="material-icons text-sm">close</span>
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              ))}
              {folders.length === 0 && !showAddFolder && (
                <p className="px-3 text-xs text-landing-forest/30 dark:text-white/20 italic">No folders yet</p>
              )}
            </div>
          </div>
        </nav>

        {/* User Profile */}
        <div className="p-3 border-t border-landing-forest/5 dark:border-white/5">
          <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-landing-forest/[0.04] dark:hover:bg-white/[0.04] transition-colors">
            {user?.user_metadata?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.user_metadata.avatar_url}
                alt=""
                className="w-8 h-8 rounded-full object-cover ring-2 ring-landing-forest/10 dark:ring-white/10"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-landing-primary/20 flex items-center justify-center">
                <span className="material-icons text-landing-primary text-sm">person</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate">{user?.user_metadata?.full_name || user?.email || 'User'}</p>
              <p className="text-[10px] text-landing-forest/40 dark:text-white/30 truncate">{user?.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="text-landing-forest/30 dark:text-white/30 hover:text-red-500 transition-colors"
              title="Sign out"
            >
              <span className="material-icons text-lg">logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 border-b border-landing-forest/5 dark:border-white/5 bg-white/60 dark:bg-[#0A0A0A]/60 backdrop-blur-xl flex items-center justify-between px-4 md:px-8 sticky top-0 z-30">
          {/* Mobile hamburger */}
          <button className="lg:hidden mr-3 p-1" onClick={() => setSidebarOpen(true)}>
            <span className="material-icons text-landing-forest/60 dark:text-white/60">menu</span>
          </button>

          {/* Search */}
          <div className="relative flex-1 max-w-xl">
            <span className="material-icons absolute left-0 top-1/2 -translate-y-1/2 text-landing-forest/30 dark:text-white/30 text-xl">search</span>
            <input
              type="text"
              placeholder="Search bookmarks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-4 py-2 bg-transparent text-sm focus:ring-0 placeholder:text-landing-forest/30 dark:placeholder:text-white/25 outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-0 top-1/2 -translate-y-1/2 text-landing-forest/30 dark:text-white/30 hover:text-landing-forest/60"
              >
                <span className="material-icons text-lg">close</span>
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 ml-4">
            <ThemeToggle className="text-landing-forest/40 dark:text-white/40 hover:text-landing-primary dark:hover:text-landing-primary hover:bg-landing-forest/5 dark:hover:bg-white/5" />
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-landing-primary hover:bg-landing-primary/90 active:scale-[0.97] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 shadow-lg shadow-landing-primary/20"
            >
              <span className="material-icons text-sm">add</span>
              <span className="hidden sm:inline">Add Bookmark</span>
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-white/30 dark:bg-black/10">
          <div className="max-w-7xl mx-auto p-4 md:p-8">
            {/* Section Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold tracking-tight">{activeTitle}</h2>
                <p className="text-xs text-landing-forest/40 dark:text-white/30 mt-0.5">
                  {filteredBookmarks.length} bookmark{filteredBookmarks.length !== 1 ? 's' : ''}
                  {searchQuery && ` matching "${searchQuery}"`}
                </p>
              </div>
              <div className="flex gap-1 p-0.5 bg-landing-forest/[0.04] dark:bg-white/[0.04] rounded-lg border border-landing-forest/5 dark:border-white/5">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-white/10 shadow-sm text-landing-forest dark:text-white' : 'text-landing-forest/35 dark:text-white/35 hover:text-landing-forest/60'}`}
                >
                  <span className="material-icons text-lg">grid_view</span>
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded transition-all ${viewMode === 'list' ? 'bg-white dark:bg-white/10 shadow-sm text-landing-forest dark:text-white' : 'text-landing-forest/35 dark:text-white/35 hover:text-landing-forest/60'}`}
                >
                  <span className="material-icons text-lg">view_list</span>
                </button>
              </div>
            </div>

            {/* Empty State */}
            {filteredBookmarks.length === 0 && (
              <div className="text-center py-24">
                <div className="w-16 h-16 bg-landing-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <span className="material-icons text-landing-primary text-3xl">
                    {searchQuery ? 'search_off' : activeNav === 'favorites' ? 'star_border' : 'bookmark_border'}
                  </span>
                </div>
                <h3 className="text-lg font-bold mb-1">{searchQuery ? 'No results found' : activeNav === 'favorites' ? 'No favorites yet' : 'No bookmarks yet'}</h3>
                <p className="text-sm text-landing-forest/40 dark:text-white/30 max-w-xs mx-auto">
                  {searchQuery
                    ? `Nothing matches "${searchQuery}". Try a different search.`
                    : activeNav === 'favorites'
                      ? 'Star a bookmark to add it to your favorites.'
                      : 'Click "Add Bookmark" to save your first link.'
                  }
                </p>
                {!searchQuery && activeNav === 'all' && (
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="mt-6 inline-flex items-center gap-2 bg-landing-primary text-white px-5 py-2.5 rounded-lg text-sm font-semibold shadow-lg shadow-landing-primary/20 hover:bg-landing-primary/90 transition-all"
                  >
                    <span className="material-icons text-sm">add</span>
                    Add Your First Bookmark
                  </button>
                )}
              </div>
            )}

            {/* Grid View */}
            {filteredBookmarks.length > 0 && viewMode === 'grid' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredBookmarks.map((bookmark) => (
                  <BookmarkCard
                    key={bookmark.id}
                    bookmark={bookmark}
                    onDelete={handleDelete}
                    onToggleFavorite={handleToggleFavorite}
                    onMove={handleMoveBookmark}
                    folders={folders}
                  />
                ))}
              </div>
            )}

            {/* List View */}
            {filteredBookmarks.length > 0 && viewMode === 'list' && (
              <div className="space-y-1">
                {filteredBookmarks.map((bookmark) => {
                  const domain = (() => { try { return new URL(bookmark.url).hostname.replace('www.', ''); } catch { return ''; } })();
                  const folder = folders.find((f) => f.id === bookmark.folder_id);
                  return (
                    <div
                      key={bookmark.id}
                      className="group flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-white dark:hover:bg-white/[0.03] transition-all cursor-pointer border border-transparent hover:border-landing-forest/5 dark:hover:border-white/5"
                    >
                      {/* Favicon */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                        alt=""
                        className="w-5 h-5 rounded-sm flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold truncate group-hover:text-landing-primary transition-colors">{bookmark.title}</h3>
                          <span className="text-[10px] text-landing-forest/30 dark:text-white/25 flex-shrink-0">{domain}</span>
                        </div>
                      </div>
                      {folder && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: `${folder.color}15`, color: folder.color }}>
                          {folder.name}
                        </span>
                      )}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleToggleFavorite(bookmark.id, bookmark.is_favorite)}
                          className={`p-1 rounded-md transition-colors ${bookmark.is_favorite ? 'text-landing-primary' : 'text-landing-forest/30 dark:text-white/30 hover:text-landing-primary'}`}
                        >
                          <span className="material-icons text-base">{bookmark.is_favorite ? 'star' : 'star_border'}</span>
                        </button>
                        <a href={bookmark.url} target="_blank" rel="noopener noreferrer" className="p-1 rounded-md text-landing-forest/30 dark:text-white/30 hover:text-landing-primary transition-colors">
                          <span className="material-icons text-base">open_in_new</span>
                        </a>
                        <button
                          onClick={() => handleDelete(bookmark.id)}
                          className="p-1 rounded-md text-landing-forest/30 dark:text-white/30 hover:text-red-500 transition-colors"
                        >
                          <span className="material-icons text-base">delete_outline</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Mobile FAB */}
      <button
        onClick={() => setShowAddModal(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-landing-primary text-white rounded-full shadow-2xl shadow-landing-primary/30 flex items-center justify-center lg:hidden hover:scale-105 transition-transform active:scale-95 z-50"
      >
        <span className="material-icons text-2xl">add</span>
      </button>

      {/* Add Bookmark Modal */}
      {showAddModal && (
        <AddBookmarkModal
          onClose={() => setShowAddModal(false)}
          folders={folders}
          userId={user?.id}
          onAdd={handleBookmarkAdded}
        />
      )}
    </div>
  );
}
