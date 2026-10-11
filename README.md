# Guess Who

A simple Guess Who board you fill with your own photos.

- **Add photos:** click any blank slot to pick a photo for it, or open the ☰ menu and use **+ Add photos** to fill the blank slots in order. You can also drag images onto the page.
- **Blur:** click a picture to blur it out. Click it again to bring it back.
- The bar at the bottom shows how many slots there are and how many people are still in (for example **7 of 12 people remaining**). Blurring someone counts them as out.
- Use **−** and **+** in the bottom bar to remove or add slots at any time. Hover a blank slot and click × to delete that slot.
- Hover a photo and click × to take it off its slot.
- The ☰ menu also has **Unblur all** to start a new round and **Remove all photos**.
- The board shows 12 slots per row (6 per row on phones) and starts with 24 blank slots.
- Photos are saved in your browser, so they're still there after a refresh. They are not uploaded anywhere.

It's a plain static site (HTML, CSS and JS) with no build step.

## Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import this repo.
2. Leave the framework preset as **Other** and click **Deploy**.

## Run locally

Open `index.html` in a browser, or run `npx serve .` in this folder.
