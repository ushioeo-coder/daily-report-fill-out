import "server-only";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error(
    "Missing environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
  );
}

/**
 * service_role key を使った Supabase クライアント。
 * RLS をバイパスするため、サーバー側 (API Route / Server Action) でのみ使用すること。
 * クライアントコンポーネントには絶対にインポートしない。
 */
export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    // 独自セッション管理のため Supabase Auth の自動セッション管理は無効化
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});
