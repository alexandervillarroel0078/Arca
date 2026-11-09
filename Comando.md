
cd C:\xampp\htdocs\Arca\backend_arca
.venv\Scripts\alembic.exe upgrade head
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 --reload

cd C:\xampp\htdocs\Arca\web_arca
npm run dev


echo "# Arca" >> README.md
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/alexandervillarroel0078/Arca.git
git push -u origin main