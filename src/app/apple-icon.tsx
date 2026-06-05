import { ImageResponse } from "next/og";

// iOS "Add to Home Screen" icon — a Poké Ball matching the in-app mark.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0f14",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            width: 150,
            height: 150,
            borderRadius: 75,
            border: "8px solid #11161d",
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
            <div style={{ flex: 1, display: "flex", background: "#ff5350" }} />
            <div style={{ flex: 1, display: "flex", background: "#f4f6f8" }} />
          </div>
          {/* center band */}
          <div
            style={{ position: "absolute", top: 67, left: 0, width: "100%", height: 16, background: "#11161d" }}
          />
          {/* center button */}
          <div
            style={{
              position: "absolute",
              top: 51,
              left: 51,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 48,
              height: 48,
              borderRadius: 24,
              background: "#f4f6f8",
              border: "9px solid #11161d",
              boxSizing: "border-box",
            }}
          >
            <div style={{ width: 12, height: 12, borderRadius: 6, background: "#11161d", display: "flex" }} />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
