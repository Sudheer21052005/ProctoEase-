import asyncio
import os
import json
from playwright.async_api import async_playwright, expect

ARTIFACT_DIR = r"C:\Users\Dell\.gemini\antigravity\brain\defb5c21-d69f-4748-90fc-5b513e521f1a"
os.makedirs(ARTIFACT_DIR, exist_ok=True)

REPORT = {
    "edge_cases": {},
    "logins": {},
    "admin_dashboard": {},
    "recruiter_dashboard": {},
    "candidate_dashboard": {},
    "errors": []
}

async def run():
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(viewport={'width': 1280, 'height': 800})
            
            # ---------------------------------------------
            # STEP 1: EDGE CASES
            # ---------------------------------------------
            page = await context.new_page()
            await page.goto("http://localhost:5173/login")
            
            # Empty fields
            await page.click('button[type="submit"]')
            await page.wait_for_timeout(500)
            
            # Check for validation messages. We assume there might be a text like "Required" or "Invalid"
            html = await page.content()
            REPORT["edge_cases"]["empty_fields_validation_triggered"] = "String must contain at least 2 character(s)" in html or "Invalid email" in html
            
            # Wrong Password
            await page.fill('input[id="tenant_slug"]', "demo-corp")
            await page.fill('input[id="email"]', "admin@proctoease.com")
            await page.fill('input[id="password"]', "WrongPass!123")
            await page.click('button[type="submit"]')
            await page.wait_for_timeout(1000)
            
            # Toast should appear, URL must still be /login
            html = await page.content()
            REPORT["edge_cases"]["wrong_password_shows_error"] = ("Invalid credentials" in html or "failed" in html.lower())
            REPORT["edge_cases"]["url_after_wrong_pass"] = page.url
            
            # ---------------------------------------------
            # STEP 2: ADMIN LOGIN & DASHBOARD
            # ---------------------------------------------
            await page.fill('input[id="password"]', "Admin@12345")
            await page.click('button[type="submit"]')
            await page.wait_for_timeout(2500)
            
            REPORT["logins"]["admin_success"] = "/admin/dashboard" in page.url
            await page.screenshot(path=os.path.join(ARTIFACT_DIR, "admin_dashboard.png"))
            
            # Check Admin Data Visibility
            html = await page.content()
            REPORT["admin_dashboard"]["totals_visible"] = "Total Exams" in html and "Total Attempts" in html
            REPORT["admin_dashboard"]["risk_chart_visible"] = "Risk Distribution" in html
            
            await page.goto("http://localhost:5173/login")
            await page.wait_for_timeout(1000)
            # Re-evaluating login clears tokens on some apps, but if it auto-redirects, we must clear storage
            await context.clear_cookies()
            await page.evaluate("localStorage.clear()")
            await page.goto("http://localhost:5173/login")
            
            # ---------------------------------------------
            # STEP 3: RECRUITER LOGIN & DASHBOARD
            # ---------------------------------------------
            await page.fill('input[id="tenant_slug"]', "demo-corp")
            await page.fill('input[id="email"]', "recruiter1@demo.com")
            await page.fill('input[id="password"]', "Recruiter@123")
            await page.click('button[type="submit"]')
            await page.wait_for_timeout(2500)
            
            REPORT["logins"]["recruiter_success"] = "/recruiter/dashboard" in page.url
            await page.screenshot(path=os.path.join(ARTIFACT_DIR, "recruiter_dashboard.png"))
            
            # Navigate to plagiarism? No, just check dashboard elements
            html = await page.content()
            REPORT["recruiter_dashboard"]["candidates_flagged"] = "Candidates" in html or "Risk" in html
            
            await context.clear_cookies()
            await page.evaluate("localStorage.clear()")
            await page.goto("http://localhost:5173/login")
            
            # ---------------------------------------------
            # STEP 4: CANDIDATE LOGIN & DASHBOARD
            # ---------------------------------------------
            await page.fill('input[id="tenant_slug"]', "demo-corp")
            await page.fill('input[id="email"]', "candidate11_cheater@demo.com")
            await page.fill('input[id="password"]', "Test@123")
            await page.click('button[type="submit"]')
            await page.wait_for_timeout(2500)
            
            REPORT["logins"]["candidate_success"] = "/candidate/dashboard" in page.url
            await page.screenshot(path=os.path.join(ARTIFACT_DIR, "candidate_dashboard.png"))
            
            html = await page.content()
            REPORT["candidate_dashboard"]["my_exams_visible"] = "Score" in html or "Duration" in html or "Status" in html
            
            await browser.close()
    except Exception as e:
        REPORT["errors"].append(str(e))

    with open("qa_report.json", "w") as f:
        json.dump(REPORT, f, indent=4)

asyncio.run(run())
