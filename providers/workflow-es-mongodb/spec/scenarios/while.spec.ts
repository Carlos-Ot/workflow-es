import { WorkflowHost, WorkflowBuilder, WorkflowStatus, WorkflowBase, StepBody, StepExecutionContext, ExecutionResult, WorkflowInstance, configureWorkflow, ConsoleLogger } from "workflow-es";
import { MongoDBPersistence } from "../../src/mongodb-provider";
import { getConnectionString } from "../helpers/config";
import { spinWaitCallback } from "../helpers/spin-wait";

 describe("while scenario", () => {

    let workflowScope = {
        step1Ticker: 0,    
        step2Ticker: 0,
        step3Ticker: 0
    }

    class Step1 extends StepBody {
        public run(context: StepExecutionContext): Promise<ExecutionResult> {
            workflowScope.step1Ticker++;
            return ExecutionResult.next();
        }
    }

    class Step2 extends StepBody {
        public run(context: StepExecutionContext): Promise<ExecutionResult> {
            workflowScope.step2Ticker++;
            return ExecutionResult.next();
        }
    }

    class Step3 extends StepBody {
        public run(context: StepExecutionContext): Promise<ExecutionResult> {
            workflowScope.step3Ticker++;
            return ExecutionResult.next();
        }
    }

    class Increment extends StepBody {
        
        public base: number;
        public result: number;
        
        public run(context: StepExecutionContext): Promise<ExecutionResult> {
            this.result = this.base + 1;
            return ExecutionResult.next();
        }
    }

    class MyDataClass {
        public value: number;
    }

    class Data_Workflow implements WorkflowBase<MyDataClass> {    
        public id: string = "while-workflow";
        public version: number = 1;

        public build(builder: WorkflowBuilder<MyDataClass>) {        
            builder
                .startWith(Step1)
                .while(data => data.value < 3).do(then => then
                    .startWith(Step2)
                    .then(Increment)
                        .input((step, data) => step.base = data.value)
                        .output((step, data) => data.value = step.result)
                    )                
                .then(Step3);
        }
    }

    let workflowId = null;
    let instance = null;
    let persistence = new MongoDBPersistence(getConnectionString());
    let config = configureWorkflow();
    config.useLogger(new ConsoleLogger());
    config.usePersistence(persistence);
    let host = config.getHost();
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 20000;

    beforeAll(async (done) => {
        host.registerWorkflow(Data_Workflow);
        await host.start();
        workflowId = await host.startWorkflow("while-workflow", 1, { value: 0 });
        spinWaitCallback(async () => {
            instance = await persistence.getWorkflowInstance(workflowId);
            return  (instance.status != WorkflowStatus.Runnable);
        }, done);
    });

    afterAll(() => {
        host.stop();
    });
    
    it("should be marked as complete", function() {
        expect(instance.status).toBe(WorkflowStatus.Complete);
    });

    it("should have taken correct execution path", function() {
        expect(workflowScope.step1Ticker).toBe(1);
        expect(workflowScope.step2Ticker).toBe(3);
        expect(workflowScope.step3Ticker).toBe(1);
    });

});