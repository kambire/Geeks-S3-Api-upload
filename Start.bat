@echo off
TITLE Geeks S3 API Upload Tool - Servidor Local
color 0B
echo ===================================================
echo     Iniciando Geeks S3 API Upload Tool...
echo ===================================================
echo.
echo Verificando dependencias (NodeJS)...
call npm install --silent

echo.
echo ===================================================
echo  ¡El servidor se esta iniciando correctamente!
echo.
echo  Por favor, no cierres esta ventana negra.
echo.
echo  La aplicacion deberia abrirse en unos segundos...
echo  Si no se abre automaticamente, visita:
echo  http://localhost:5173
echo ===================================================
echo.

:: Abre el navegador predeterminado (Vite generalmente abrirá uno también, pero lo forzamos por si acaso falla).
start http://localhost:5173

:: Inicia el servidor de desarrollo en la consola
call npm run dev
pause
