/**
 * Fetch LinkedIn profile photos for trainers and update their profile_picture_url.
 *
 * Usage:  node scripts/fetch-linkedin-photos.mjs
 *
 * Strategy:
 *   1. Query DB for trainers with a linkedin_url but no (or empty) profile_picture_url.
 *      Also include Dr. Alfred Ang (user_id 1769c9cc-...) regardless.
 *   2. Fetch the public LinkedIn page for each trainer.
 *   3. Extract the profile photo from JSON-LD (Person.image) or og:image meta tag.
 *   4. Update app_user.profile_picture_url with the extracted URL.
 */

import pg from "pg";
import dotenv from "dotenv";
dotenv.config();
const { Client } = pg;

const DB_URL = process.env.DATABASE_URL;

const ALFRED_ANG_ID = "1769c9cc-362c-4985-a529-545cd88bb34d";
const DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a LinkedIn URL to https://www.linkedin.com/in/slug/ */
function normalizeLinkedInUrl(raw) {
  let url = raw.trim();
  // Strip protocol
  url = url.replace(/^https?:\/\//, "");
  // Normalise host variants (sg.linkedin.com, uk.linkedin.com, etc.)
  url = url.replace(/^[a-z]{2}\.linkedin\.com/, "www.linkedin.com");
  if (!url.startsWith("www.linkedin.com")) {
    url = url.replace(/^linkedin\.com/, "www.linkedin.com");
  }
  // Ensure trailing slash
  if (!url.endsWith("/")) url += "/";
  return `https://${url}`;
}

/** Extract profile photo URL from HTML (JSON-LD first, then og:image fallback). */
function extractProfilePhoto(html) {
  // --- Try JSON-LD structured data first ---
  const ldJsonRegex =
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = ldJsonRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const graphs = data["@graph"] || (Array.isArray(data) ? data : [data]);
      for (const node of graphs) {
        if (node["@type"] === "Person" && node.image) {
          const img = node.image;
          if (typeof img === "string") return img;
          if (img.contentUrl) return img.contentUrl;
          if (img.url) return img.url;
        }
      }
    } catch {
      // JSON parse failed, try next block
    }
  }

  // --- Fallback: og:image meta tag ---
  const ogMatch = html.match(
    /<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']+)["']/i
  );
  if (ogMatch) {
    // Decode HTML entities
    return ogMatch[1].replace(/&amp;/g, "&");
  }

  // Also try reversed attribute order (content before property)
  const ogMatch2 = html.match(
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:image["']/i
  );
  if (ogMatch2) {
    return ogMatch2[1].replace(/&amp;/g, "&");
  }

  return null;
}

/** Check if a URL points to the LinkedIn default/ghost profile image. */
function isDefaultAvatar(url) {
  if (!url) return true;
  // LinkedIn ghost profile images contain "ghost" in the path
  if (/\/ghp_/.test(url) || /ghost/i.test(url)) return true;
  // Static default images
  if (url.includes("/dms/image/v2/") === false && url.includes("static.licdn.com")) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  console.log("Connected to database.\n");

  // Fetch trainers who need a profile photo, plus Dr. Alfred Ang unconditionally
  const { rows: trainers } = await client.query(`
    SELECT tp.user_id, au.full_name, tp.linkedin_url, au.profile_picture_url
    FROM trainer_profile tp
    JOIN app_user au ON au.id = tp.user_id
    WHERE tp.linkedin_url IS NOT NULL
      AND tp.linkedin_url <> ''
      AND (
        au.profile_picture_url IS NULL
        OR au.profile_picture_url = ''
        OR tp.user_id = $1
      )
    ORDER BY au.full_name
  `, [ALFRED_ANG_ID]);

  console.log(`Found ${trainers.length} trainers to process.\n`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < trainers.length; i++) {
    const t = trainers[i];
    const num = `[${i + 1}/${trainers.length}]`;
    const linkedinUrl = normalizeLinkedInUrl(t.linkedin_url);

    console.log(`${num} ${t.full_name} — ${linkedinUrl}`);

    try {
      const resp = await fetch(linkedinUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      });

      if (!resp.ok) {
        console.log(`  SKIP — HTTP ${resp.status}`);
        skipped++;
        await sleep(DELAY_MS);
        continue;
      }

      const html = await resp.text();
      const photoUrl = extractProfilePhoto(html);

      if (!photoUrl || isDefaultAvatar(photoUrl)) {
        console.log(`  SKIP — no usable profile photo found`);
        skipped++;
        await sleep(DELAY_MS);
        continue;
      }

      // Update the database
      await client.query(
        `UPDATE app_user SET profile_picture_url = $1 WHERE id = $2`,
        [photoUrl, t.user_id]
      );

      console.log(`  UPDATED — ${photoUrl.substring(0, 100)}...`);
      updated++;
    } catch (err) {
      console.log(`  ERROR — ${err.message}`);
      failed++;
    }

    if (i < trainers.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed:  ${failed}`);
  console.log(`Total:   ${trainers.length}`);

  await client.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
