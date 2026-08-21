import { NextResponse } from "next/server";
import { getImage } from "@/lib/images";

export async function GET(request, { params }) {
  const { id } = await params;
  const image = await getImage(id);
  if (!image) {
    return new NextResponse("Not found", { status: 404 });
  }

  const buffer = Buffer.from(image.base64, "base64");
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": image.contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
