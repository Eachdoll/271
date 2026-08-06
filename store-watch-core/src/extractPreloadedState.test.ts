import { extractPreloadedState } from "./extractPreloadedState";

describe("extractPreloadedState", () => {
  it("HTML에 인라인된 상태 JSON을 파싱한다", () => {
    const html = `
      <html><body><script>
        window.__PRELOADED_STATE__ = {"store":{"name":"마이스토어"},"products":[]};
      </script></body></html>
    `;

    expect(extractPreloadedState(html)).toEqual({
      store: { name: "마이스토어" },
      products: [],
    });
  });

  it("문자열 안의 중괄호에 속지 않는다", () => {
    const html = `<script>window.__PRELOADED_STATE__ = {"desc":"닫는 괄호 } 포함","ok":true};</script>`;

    expect(extractPreloadedState(html)).toEqual({
      desc: "닫는 괄호 } 포함",
      ok: true,
    });
  });

  it("이스케이프된 따옴표를 문자열 종료로 오인하지 않는다", () => {
    const html = `<script>window.__PRELOADED_STATE__ = {"desc":"따옴표 \\" 와 } 괄호","ok":true};</script>`;

    expect(extractPreloadedState(html)).toEqual({
      desc: '따옴표 " 와 } 괄호',
      ok: true,
    });
  });

  it("뒤따르는 스크립트가 있어도 상태 객체만 잘라낸다", () => {
    const html = `
      <script>window.__PRELOADED_STATE__ = {"a":{"b":1}};</script>
      <script>window.somethingElse = {"c":2};</script>
    `;

    expect(extractPreloadedState(html)).toEqual({ a: { b: 1 } });
  });

  it("__NEXT_DATA__ 형태도 지원한다", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{"props":{"x":1}}</script>`;

    expect(extractPreloadedState(html)).toEqual({ props: { x: 1 } });
  });

  it("상태 JSON이 없으면 null을 반환한다", () => {
    expect(extractPreloadedState("<html><body>없음</body></html>")).toBeNull();
    expect(extractPreloadedState("")).toBeNull();
  });

  it("괄호 짝이 맞지 않으면 null을 반환한다", () => {
    expect(
      extractPreloadedState(`<script>window.__PRELOADED_STATE__ = {"a":1`),
    ).toBeNull();
  });

  it("JSON이 아닌 값이면 null을 반환한다", () => {
    expect(
      extractPreloadedState(
        `<script>window.__PRELOADED_STATE__ = {a:1};</script>`,
      ),
    ).toBeNull();
  });
});
