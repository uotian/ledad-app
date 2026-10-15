use super::*;
use std::time::Duration;

struct Fixture(Service);
impl Drop for Fixture {
    fn drop(&mut self) {
        self.0.stop();
    }
}

fn python(program: &str, ready: bool) -> (Fixture, watch::Sender<bool>) {
    let child = Command::new("/usr/bin/python3")
        .args(["-u", "-c", program])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let (sender, receiver) = watch::channel(ready);
    (Fixture(Service::connect(child, receiver).unwrap()), sender)
}

fn input(id: &str) -> Value {
    json!({"id":id, "path":"/api/sessions", "method":"GET"})
}

async fn bounded<T>(future: impl std::future::Future<Output = T>) -> T {
    tokio::time::timeout(Duration::from_secs(5), future)
        .await
        .expect("service must not leave a caller waiting")
}

async fn start_waiting<F: std::future::Future>(mut future: std::pin::Pin<&mut F>) {
    std::future::poll_fn(|cx| {
        assert!(
            future.as_mut().poll(cx).is_pending(),
            "request should still be waiting"
        );
        std::task::Poll::Ready(())
    })
    .await;
}

#[tokio::test]
async fn reversed_replies_and_partial_text_are_routed_without_completing_early() {
    let (fixture, _ready) = python(
        r#"import json, sys
a, b = [json.loads(sys.stdin.readline()) for _ in range(2)]
print('not json')
print(json.dumps({'text':'missing id'}))
print(json.dumps({'id':'unknown','status':200}))
print(json.dumps({'id':a['id'],'text':'partial'}))
print(json.dumps({'id':b['id'],'status':201}))
print(json.dumps({'id':a['id'],'status':200,'body':'finished'}))
for line in sys.stdin: pass
"#,
        true,
    );
    let texts = Arc::new(Mutex::new(Vec::new()));
    let received = texts.clone();
    let channel = Channel::new(move |body| {
        if let tauri::ipc::InvokeResponseBody::Json(text) = body {
            received
                .lock()
                .unwrap()
                .push(serde_json::from_str::<String>(&text).unwrap());
        }
        Ok(())
    });
    let (a, b) = bounded(async {
        tokio::join!(
            fixture.0.request(input("a"), Some(channel)),
            fixture.0.request(input("b"), None)
        )
    })
    .await;
    assert_eq!(a.unwrap(), json!({"id":"a","status":200,"body":"finished"}));
    assert_eq!(b.unwrap()["status"], 201);
    assert_eq!(*texts.lock().unwrap(), ["partial"]);
    assert!(fixture.0.pending.lock().unwrap().is_empty());
}

#[tokio::test]
async fn python_eof_rejects_every_pending_request() {
    let (fixture, _ready) = python(
        "import sys\nsys.stdin.readline()\nsys.stdin.readline()\n",
        true,
    );
    let (a, b) = bounded(async {
        tokio::join!(
            fixture.0.request(input("a"), None),
            fixture.0.request(input("b"), None)
        )
    })
    .await;
    for result in [a, b] {
        assert!(result.unwrap_err().contains("内部処理が終了"));
    }
    assert!(fixture.0.pending.lock().unwrap().is_empty());
}

#[tokio::test]
async fn timeout_sends_matching_cancel_and_next_request_still_works() {
    check_timeout("/api/sessions", 180).await;
}

#[tokio::test]
async fn document_preparation_has_its_own_longer_timeout() {
    check_timeout("/api/sessions/meeting/document-reference", 300).await;
}

async fn check_timeout(path: &str, seconds: u64) {
    let (fixture, _ready) = python(
        r#"import json, sys
cancelled = None
for line in sys.stdin:
    value = json.loads(line)
    if 'cancel' in value: cancelled = value['cancel']
    elif value['id'] != 'slow':
        print(json.dumps({'id':value['id'],'status':200,'cancelled':cancelled}))
"#,
        true,
    );
    let request = fixture
        .0
        .request(json!({"id":"slow","path":path,"method":"POST"}), None);
    tokio::pin!(request);
    start_waiting(request.as_mut()).await;
    assert_eq!(fixture.0.pending.lock().unwrap().len(), 1);
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(seconds - 1)).await;
    start_waiting(request.as_mut()).await;
    tokio::time::advance(Duration::from_secs(2)).await;
    assert!(request.await.unwrap_err().contains("時間がかかっています"));
    tokio::time::resume();
    assert!(fixture.0.pending.lock().unwrap().is_empty());
    let reply = bounded(fixture.0.request(input("next"), None))
        .await
        .unwrap();
    assert_eq!(reply["cancelled"], "slow");
}

#[tokio::test]
async fn credentials_timeout_sends_no_request_and_can_be_retried_after_initialization() {
    let (fixture, ready) = python(
        "import json, sys\nfor count, line in enumerate(sys.stdin, 1):\n v=json.loads(line)\n print(json.dumps({'id':v['id'],'status':200,'count':count}))\n", false,
    );
    let request = fixture
        .0
        .request(json!({"id":"ai","path":"/api/config"}), None);
    tokio::pin!(request);
    start_waiting(request.as_mut()).await;
    tokio::time::pause();
    tokio::time::advance(Duration::from_secs(31)).await;
    assert!(request.await.unwrap_err().contains("キーチェーン"));
    tokio::time::resume();
    assert!(fixture.0.pending.lock().unwrap().is_empty());
    ready.send(true).unwrap();
    let retry = bounded(
        fixture
            .0
            .request(json!({"id":"ai","path":"/api/config"}), None),
    )
    .await;
    let reply = retry.unwrap();
    assert_eq!(reply["status"], 200);
    assert_eq!(reply["count"], 1, "timed-out request must not reach Python");
}

#[tokio::test]
async fn stop_reaps_python_and_releases_waiters_and_broken_pipe_leaves_no_pending_entry() {
    let (fixture, _ready) = python("import sys\nfor line in sys.stdin: pass\n", true);
    let request = fixture.0.request(input("pending"), None);
    tokio::pin!(request);
    start_waiting(request.as_mut()).await;
    fixture.0.stop();
    fixture.0.stop();
    assert!(fixture
        .0
        .child
        .lock()
        .unwrap()
        .try_wait()
        .unwrap()
        .is_some());
    assert!(bounded(request).await.is_err());
    assert!(bounded(fixture.0.request(input("after-exit"), None))
        .await
        .is_err());
    assert!(fixture.0.pending.lock().unwrap().is_empty());
}

#[tokio::test]
async fn missing_credentials_do_not_block_local_reads_but_reject_ai_requests() {
    let (fixture, ready) = python(
        "import json, sys\nfor line in sys.stdin:\n v=json.loads(line)\n print(json.dumps({'id':v['id'],'status':200}))\n", false,
    );
    assert_eq!(
        bounded(fixture.0.request(input("local"), None))
            .await
            .unwrap()["status"],
        200
    );
    drop(ready);
    let ai = json!({"id":"ai", "path":"/api/config"});
    assert!(bounded(fixture.0.request(ai, None))
        .await
        .unwrap_err()
        .contains("APIキーを読み込めません"));
    assert!(fixture.0.pending.lock().unwrap().is_empty());
}

#[tokio::test]
async fn explicit_cancel_completes_only_its_request() {
    let (fixture, _ready) = python(
        r#"import json, sys
for line in sys.stdin:
    value = json.loads(line)
    if 'cancel' in value:
        print(json.dumps({'id':value['cancel'],'status':499}))
    elif value['id'] != 'cancel-me':
        print(json.dumps({'id':value['id'],'status':200}))
"#,
        true,
    );
    let request = fixture.0.request(input("cancel-me"), None);
    tokio::pin!(request);
    start_waiting(request.as_mut()).await;
    fixture.0.send(&json!({"cancel":"cancel-me"})).unwrap();
    assert_eq!(bounded(request).await.unwrap()["status"], 499);
    assert_eq!(
        bounded(fixture.0.request(input("other"), None))
            .await
            .unwrap()["status"],
        200
    );
    assert!(fixture.0.pending.lock().unwrap().is_empty());
}
