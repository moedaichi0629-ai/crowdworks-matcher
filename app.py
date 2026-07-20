import json
import logging
import os
import re

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from starlette.requests import Request

import db
from prompts import (
    build_application_prompt,
    build_chat_system_prompt,
    build_diagnosis_prompt,
    build_reply_prompt,
)

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("crowdworks-matcher")

MODEL_NAME = "claude-sonnet-4-5"

app = FastAPI(title="クラウドワークス案件マッチャー")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


@app.on_event("startup")
async def on_startup():
    db.init_db()


def get_client() -> anthropic.Anthropic:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY が設定されていません。.env ファイルを作成し、APIキーを設定してください。",
        )
    return anthropic.Anthropic(api_key=api_key)


def anthropic_error_to_http(e: anthropic.APIError) -> HTTPException:
    """anthropic SDKの例外を、フロントに表示するわかりやすいHTTPExceptionに変換する。"""
    if isinstance(e, anthropic.AuthenticationError):
        logger.error("Anthropic認証エラー: %s", e)
        return HTTPException(
            status_code=502,
            detail="APIキーが正しくありません。.env の ANTHROPIC_API_KEY を確認してください。",
        )
    if isinstance(e, anthropic.RateLimitError):
        logger.error("Anthropicレート制限エラー: %s", e)
        return HTTPException(
            status_code=502,
            detail="APIの利用上限に達しました。しばらく待ってから再度お試しください。",
        )
    if isinstance(e, anthropic.APIConnectionError):
        logger.error("Anthropic接続エラー: %s", e)
        return HTTPException(
            status_code=502,
            detail="AI APIへの接続に失敗しました。インターネット接続、プロキシ設定、ファイアウォールをご確認ください。",
        )
    if isinstance(e, anthropic.APIStatusError):
        logger.error("Anthropic APIエラー: %s", e)
        return HTTPException(
            status_code=502, detail=f"AIとの通信でエラーが発生しました: {e.message}"
        )
    logger.error("Anthropic APIエラー: %s", e)
    return HTTPException(status_code=502, detail=f"AIとの通信でエラーが発生しました: {e}")


def extract_json(text: str) -> dict:
    """レスポンステキストからJSONオブジェクトを抽出してパースする。"""
    text = text.strip()
    # コードブロックで囲まれている場合は中身を取り出す
    fence_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1)
    else:
        # 先頭の { から末尾の } までを取り出す
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            text = text[start : end + 1]
    return json.loads(text)


class DiagnoseRequest(BaseModel):
    job_text: str


class DiagnoseResponse(BaseModel):
    judgment: str
    score: int
    reasons: dict
    summary: str


class GenerateRequest(BaseModel):
    job_text: str
    diagnosis: dict


class GenerateResponse(BaseModel):
    application_text: str


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    job_text: str
    message: str
    diagnosis: dict | None = None
    application_text: str | None = None
    history: list[ChatMessage] = []


class ChatResponse(BaseModel):
    reply: str


CHAT_HISTORY_LIMIT = 20  # 直近のやり取りのみをコンテキストに含める（コスト・トークン数の抑制）


class SaveApplicationRequest(BaseModel):
    job_text: str
    diagnosis: dict | None = None
    application_text: str


class SaveApplicationResponse(BaseModel):
    id: int


class ApplicationSummary(BaseModel):
    id: int
    title: str
    judgment: str | None = None
    score: int | None = None
    created_at: str
    reply_count: int
    last_reply_at: str | None = None


class ReplyItem(BaseModel):
    id: int
    client_message: str
    suggested_response: str | None = None
    created_at: str


class ApplicationDetail(BaseModel):
    id: int
    title: str
    job_text: str
    diagnosis: dict | None = None
    application_text: str
    created_at: str
    replies: list[ReplyItem]


class AddReplyRequest(BaseModel):
    client_message: str


class AddReplyResponse(BaseModel):
    id: int
    suggested_response: str


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/history", response_class=HTMLResponse)
async def history_page(request: Request):
    return templates.TemplateResponse(request, "history.html")


@app.post("/api/diagnose", response_model=DiagnoseResponse)
async def diagnose(payload: DiagnoseRequest):
    job_text = payload.job_text.strip()
    if not job_text:
        raise HTTPException(status_code=400, detail="案件文章が入力されていません。")

    client = get_client()
    prompt = build_diagnosis_prompt(job_text)

    last_error: Exception | None = None
    for attempt in range(2):
        try:
            message = client.messages.create(
                model=MODEL_NAME,
                max_tokens=2000,
                messages=[{"role": "user", "content": prompt}],
            )
            raw_text = "".join(
                block.text for block in message.content if block.type == "text"
            )
            data = extract_json(raw_text)

            if data.get("judgment") not in ("◎", "○", "△", "✕"):
                raise ValueError(f"不正なjudgment値: {data.get('judgment')}")
            if not isinstance(data.get("score"), int):
                raise ValueError(f"不正なscore値: {data.get('score')}")
            if not isinstance(data.get("reasons"), dict):
                raise ValueError("reasonsがオブジェクトではありません")
            if not isinstance(data.get("summary"), str):
                raise ValueError("summaryが文字列ではありません")

            return DiagnoseResponse(**data)
        except anthropic.APIError as e:
            raise anthropic_error_to_http(e) from e
        except (json.JSONDecodeError, ValueError, KeyError) as e:
            last_error = e
            logger.warning("診断結果のJSONパースに失敗（試行 %d回目）: %s", attempt + 1, e)
            continue

    raise HTTPException(
        status_code=502,
        detail=f"AIの診断結果を正しく読み取れませんでした。もう一度お試しください。（詳細: {last_error}）",
    )


@app.post("/api/generate", response_model=GenerateResponse)
async def generate(payload: GenerateRequest):
    job_text = payload.job_text.strip()
    if not job_text:
        raise HTTPException(status_code=400, detail="案件文章が入力されていません。")
    if not payload.diagnosis:
        raise HTTPException(status_code=400, detail="診断結果が渡されていません。先に診断を実行してください。")

    client = get_client()
    prompt = build_application_prompt(job_text, payload.diagnosis)

    try:
        message = client.messages.create(
            model=MODEL_NAME,
            max_tokens=1500,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = "".join(
            block.text for block in message.content if block.type == "text"
        ).strip()
        if not raw_text:
            raise HTTPException(status_code=502, detail="応募文の生成に失敗しました。もう一度お試しください。")
        return GenerateResponse(application_text=raw_text)
    except anthropic.APIError as e:
        raise anthropic_error_to_http(e) from e


@app.post("/api/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest):
    job_text = payload.job_text.strip()
    message = payload.message.strip()
    if not job_text:
        raise HTTPException(status_code=400, detail="案件文章が入力されていません。先に案件文章を貼り付けてください。")
    if not message:
        raise HTTPException(status_code=400, detail="質問内容が入力されていません。")

    client = get_client()
    system_prompt = build_chat_system_prompt(
        job_text, payload.diagnosis, payload.application_text
    )

    history = payload.history[-CHAT_HISTORY_LIMIT:]
    messages = [{"role": m.role, "content": m.content} for m in history]
    messages.append({"role": "user", "content": message})

    try:
        response = client.messages.create(
            model=MODEL_NAME,
            max_tokens=1000,
            system=system_prompt,
            messages=messages,
        )
        raw_text = "".join(
            block.text for block in response.content if block.type == "text"
        ).strip()
        if not raw_text:
            raise HTTPException(status_code=502, detail="回答の生成に失敗しました。もう一度お試しください。")
        return ChatResponse(reply=raw_text)
    except anthropic.APIError as e:
        raise anthropic_error_to_http(e) from e


@app.post("/api/applications", response_model=SaveApplicationResponse)
async def create_application(payload: SaveApplicationRequest):
    job_text = payload.job_text.strip()
    application_text = payload.application_text.strip()
    if not job_text:
        raise HTTPException(status_code=400, detail="案件文章が入力されていません。")
    if not application_text:
        raise HTTPException(status_code=400, detail="応募文が生成されていません。先に応募文を生成してください。")

    application_id = db.save_application(job_text, payload.diagnosis, application_text)
    return SaveApplicationResponse(id=application_id)


@app.get("/api/applications", response_model=list[ApplicationSummary])
async def get_applications():
    return db.list_applications()


@app.get("/api/applications/{application_id}", response_model=ApplicationDetail)
async def get_application_detail(application_id: int):
    application = db.get_application(application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="指定された応募履歴が見つかりません。")
    return application


@app.delete("/api/applications/{application_id}")
async def delete_application(application_id: int):
    deleted = db.delete_application(application_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="指定された応募履歴が見つかりません。")
    return {"deleted": True}


@app.post("/api/applications/{application_id}/replies", response_model=AddReplyResponse)
async def create_reply(application_id: int, payload: AddReplyRequest):
    client_message = payload.client_message.strip()
    if not client_message:
        raise HTTPException(status_code=400, detail="クライアントからの返信内容が入力されていません。")

    application = db.get_application(application_id)
    if application is None:
        raise HTTPException(status_code=404, detail="指定された応募履歴が見つかりません。")

    client = get_client()
    prompt = build_reply_prompt(
        application["job_text"],
        application["diagnosis"],
        application["application_text"],
        application["replies"],
        client_message,
    )

    try:
        response = client.messages.create(
            model=MODEL_NAME,
            max_tokens=1200,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = "".join(
            block.text for block in response.content if block.type == "text"
        ).strip()
        if not raw_text:
            raise HTTPException(status_code=502, detail="返信案の生成に失敗しました。もう一度お試しください。")
    except anthropic.APIError as e:
        raise anthropic_error_to_http(e) from e

    reply_id = db.add_reply(application_id, client_message, raw_text)
    return AddReplyResponse(id=reply_id, suggested_response=raw_text)
