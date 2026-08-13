export const LANDING_PAGE_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Swapmess Backend</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: 'Inter', sans-serif;
            background: #fafafa;
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            color: #333;
        }
        .container {
            text-align: center;
            background: white;
            padding: 4rem 3rem;
            border-radius: 16px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.02);
            max-width: 600px;
            width: 90%;
            border-top: 4px solid #E0234E;
            animation: fadeIn 0.6s ease-out;
        }
        .logo {
            width: 90px;
            margin-bottom: 1.5rem;
            animation: float 3s ease-in-out infinite;
        }
        h1 {
            font-weight: 800;
            font-size: 2rem;
            margin-bottom: 1rem;
            color: #111;
        }
        .highlight {
            color: #E0234E;
        }
        p {
            color: #666;
            font-size: 1.1rem;
            line-height: 1.6;
            margin-bottom: 2rem;
        }
        .features {
            display: flex;
            justify-content: center;
            gap: 1rem;
            flex-wrap: wrap;
        }
        .badge {
            background: #fff0f3;
            color: #E0234E;
            padding: 0.5rem 1rem;
            border-radius: 8px;
            font-size: 0.85rem;
            font-weight: 600;
            border: 1px solid #ffe1e8;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-5px); }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Welcome to <span class="highlight">CrowdMatch</span> Backend</h1>
        <p>A Secure And Modern Dating Or Matching Platform.</p>
        <div class="features">
            <span class="badge">Scalable</span>
            <span class="badge">NestJS</span>
        </div>
    </div>
</body>
</html>
    `;
