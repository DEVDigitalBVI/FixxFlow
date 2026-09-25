import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { validId } from "@/features/knowledge/content";
export async function GET(request: Request, { params }: { params: Promise<{assetId: string}> }) {
  const viewer = await requireViewer(); const { assetId } = await params;
  if (!validId(assetId)) return new Response("Not found",{status:404});
  const database = await createClient();
  const { data: asset } = await database.from("knowledge_attachments").select("*").eq("organization_id",viewer.organizationId).eq("id",assetId).maybeSingle();
  if (!asset) return new Response("Not found",{status:404});
  const { data, error } = await database.storage.from("knowledge-assets").download(asset.storage_path);
  if (error || !data) return new Response("File unavailable. Please retry.",{status:503});
  const inline = ["image/jpeg","image/png","image/webp"].includes(asset.content_type) && new URL(request.url).searchParams.get("download") !== "1";
  return new Response(data.stream(), { headers: { "Content-Type": inline ? asset.content_type : "application/octet-stream", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(asset.file_name).replace(/'/g,"%27")}`, "Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff" } });
}
