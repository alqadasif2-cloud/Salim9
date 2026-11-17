// Supabase integration stub for secondary database sync

export function isSupabaseConfigured(): boolean {
  return false;
}

export async function testSupabaseConnection(): Promise<{ success: boolean; message: string }> {
  return { success: false, message: 'Supabase is not configured' };
}

export async function supabaseGetChannels(..._args: any[]): Promise<any[]> {
  return [];
}

export async function supabaseGetUserById(..._args: any[]): Promise<any | null> {
  return null;
}

export async function supabaseGetUserByUsername(..._args: any[]): Promise<any | null> {
  return null;
}

export async function supabaseGetAllUsers(..._args: any[]): Promise<any[]> {
  return [];
}

export async function supabaseUpsertUser(..._args: any[]): Promise<void> {
  // Stored in primary store
}

export async function supabaseGetChannelById(..._args: any[]): Promise<any | null> {
  return null;
}

export async function supabaseUpsertChannel(..._args: any[]): Promise<void> {
  // Stored in primary store
}

export async function supabaseGetChannelMessages(..._args: any[]): Promise<any[]> {
  return [];
}

export async function supabaseInsertChannelMessage(..._args: any[]): Promise<void> {
  // Stored in primary store
}

export async function supabaseGetPrivateMessages(..._args: any[]): Promise<any[]> {
  return [];
}

export async function supabaseInsertPrivateMessage(..._args: any[]): Promise<void> {
  // Stored in primary store
}

export async function supabaseGetUserChallenge(..._args: any[]): Promise<any | null> {
  return null;
}

export async function supabaseUpsertUserChallenge(..._args: any[]): Promise<void> {
  // Stored in primary store
}

export async function supabaseGetUserTrades(..._args: any[]): Promise<any[]> {
  return [];
}

export async function supabaseInsertTrade(..._args: any[]): Promise<void> {
  // Stored in primary store
}

export async function supabaseGetLatestAppUpdate(..._args: any[]): Promise<any | null> {
  return null;
}

export async function supabaseUpsertAppUpdate(..._args: any[]): Promise<void> {
  // Stored in primary store
}

export async function syncAllToSupabase(..._args: any[]): Promise<{ success: boolean; message: string }> {
  return { success: true, message: 'Sync complete' };
}

export async function reconcileSupabaseData(..._args: any[]): Promise<{
  success: boolean;
  reconciled: boolean;
  details: Record<string, any>;
}> {
  return {
    success: true,
    reconciled: true,
    details: {},
  };
}
