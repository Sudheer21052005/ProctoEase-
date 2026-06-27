import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        # Listen for console logs
        page.on("console", lambda msg: print(f"Browser console ({msg.type}): {msg.text}"))
        # Listen for response
        page.on("response", lambda response: print(f"Response: {response.url} - {response.status}"))
        
        await page.goto("http://localhost:5173/login")
        
        await page.fill('input[id="tenant_slug"]', "demo-corp")
        await page.fill('input[id="email"]', "admin@proctoease.com")
        await page.fill('input[id="password"]', "Admin@12345")
        
        await page.click('button[type="submit"]')
        
        await page.wait_for_timeout(3000)
        print("Final URL:", page.url)
        
        await browser.close()

asyncio.run(run())
